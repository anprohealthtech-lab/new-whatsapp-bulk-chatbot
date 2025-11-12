import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  WASocket,
  AuthenticationState,
  ConnectionState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { EventEmitter } from 'events';
import { log } from '../utils.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { storage } from '../storage.js';
import PQueue from 'p-queue';

interface UserSession {
  userId: string;
  userName: string;
  clinicName: string;
  socket: WASocket | null;
  isConnected: boolean;
  isAuthenticated: boolean;
  phoneNumber?: string;
  lastActivity: Date;
  qrCode?: string;
  authPath: string; // Persistent auth directory
  reconnectAttempts: number;
  sessionId: string;
  reconnectTimeout?: NodeJS.Timeout;
  isPairing: boolean; // Track pairing state
  status: 'disconnected' | 'connecting' | 'connected' | 'pairing' | 'restarting';
}

interface SessionStrategy {
  name: 'business_hours' | 'always_on' | 'on_demand';
  duration: number; // milliseconds
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  businessHoursOnly?: boolean;
}

export class MultiUserWhatsAppService extends EventEmitter {
  private userSessionsByUser: Map<string, UserSession> = new Map(); // Key by userId
  private readonly authBaseDir = './auth';
  private readonly maxReconnectAttempts = 5;
  private readonly maxGlobalSessions = 15;
  private userLocks = new Map<string, PQueue>(); // Per-user mutex locks
  private userLastConnectionAttempt: Map<string, number> = new Map();
  private connectionHealthMap = new Map<
    string,
    { connects: number; disconnects: number; lastStableConnection?: Date }
  >();

  private readonly SESSION_STRATEGIES: Record<string, SessionStrategy> = {
    business_hours: {
      name: 'business_hours',
      duration: 8 * 60 * 60 * 1000,
      autoReconnect: true,
      maxReconnectAttempts: 5,
      businessHoursOnly: true
    },
    always_on: {
      name: 'always_on',
      duration: 24 * 60 * 60 * 1000,
      autoReconnect: true,
      maxReconnectAttempts: 10,
      businessHoursOnly: false
    },
    on_demand: {
      name: 'on_demand',
      duration: 2 * 60 * 60 * 1000,
      autoReconnect: false,
      maxReconnectAttempts: 3,
      businessHoursOnly: false
    }
  };

  constructor() {
    super();
    this.ensureAuthDirectory();

    // Clean up inactive sessions with configurable interval
    const cleanupInterval = parseInt(process.env.SESSION_CLEANUP_INTERVAL || '300000'); // 5 min
    setInterval(() => this.cleanupInactiveSessions(), cleanupInterval);

    // Schedule daily database cleanup at 9 PM IST (3:30 PM UTC)
    this.scheduleDailyDatabaseCleanup();

    log(`🚀 Multi-User WhatsApp Service initialized with limits:`);
    log(`   - Max Global Sessions: ${this.maxGlobalSessions}`);
    log(`   - Max Sessions Per User: ${process.env.WHATSAPP_MAX_SESSIONS_PER_USER || 3}`);
    log(`   - Cleanup Interval: ${cleanupInterval / 1000}s`);
    log(`   - Inactive Timeout: ${process.env.INACTIVE_SESSION_TIMEOUT || 300000}ms`);
    log(`   - Daily DB Cleanup: 9:00 PM IST (3:30 PM UTC)`);
  }

  private ensureAuthDirectory() {
    if (!fs.existsSync(this.authBaseDir)) {
      fs.mkdirSync(this.authBaseDir, { recursive: true });
    }
  }

  /**
   * Schedule daily database cleanup at 9 PM IST (3:30 PM UTC)
   */
  private scheduleDailyDatabaseCleanup() {
    const scheduleNext = () => {
      const now = new Date();
      const target = new Date();
      
      // Set target to 9 PM IST (3:30 PM UTC)
      target.setUTCHours(15, 30, 0, 0); // 3:30 PM UTC = 9:00 PM IST
      
      // If we've passed today's cleanup time, schedule for tomorrow
      if (now > target) {
        target.setUTCDate(target.getUTCDate() + 1);
      }
      
      const timeUntilCleanup = target.getTime() - now.getTime();
      console.log(`📅 Next database cleanup scheduled for: ${target.toISOString()} (in ${Math.round(timeUntilCleanup / (1000 * 60 * 60))} hours)`);
      
      setTimeout(async () => {
        await this.performDatabaseCleanup();
        scheduleNext(); // Schedule the next cleanup
      }, timeUntilCleanup);
    };
    
    scheduleNext();
  }

  /**
   * Perform comprehensive database cleanup
   */
  private async performDatabaseCleanup() {
    try {
      console.log('🧹 Starting scheduled database cleanup...');
      
      const startTime = Date.now();
      
      // Step 1: Clean failed sessions
      const failedCount = await storage.cleanupFailedSessions();
      console.log(`🗑️ Cleaned ${failedCount} failed sessions`);
      
      // Step 2: Clean orphaned sessions (older than 7 days)
      const orphanedCount = await storage.cleanupOrphanedSessions(7);
      console.log(`🗑️ Cleaned ${orphanedCount} orphaned sessions`);
      
      // Step 3: Clean orphaned auth directories
      const authCleanupCount = await this.cleanupOrphanedAuthDirectories();
      console.log(`🗑️ Cleaned ${authCleanupCount} orphaned auth directories`);
      
      const duration = Date.now() - startTime;
      const totalCleaned = failedCount + orphanedCount + authCleanupCount;
      
      console.log(`✅ Database cleanup completed in ${duration}ms - Total items cleaned: ${totalCleaned}`);
      
      // Log the cleanup event
      await storage.createSystemLog({
        level: 'info',
        message: `Scheduled database cleanup completed`,
        service: 'whatsapp',
        metadata: JSON.stringify({
          duration,
          failedSessions: failedCount,
          orphanedSessions: orphanedCount,
          orphanedAuthDirs: authCleanupCount,
          totalCleaned
        })
      });
      
    } catch (error) {
      console.error('❌ Database cleanup failed:', error);
      await storage.createSystemLog({
        level: 'error',
        message: 'Scheduled database cleanup failed',
        service: 'whatsapp',
        metadata: JSON.stringify({ error: (error as Error).message })
      });
    }
  }

  /**
   * Clean up orphaned auth directories that don't have corresponding database sessions
   */
  private async cleanupOrphanedAuthDirectories(): Promise<number> {
    try {
      let cleanedCount = 0;
      
      if (!fs.existsSync(this.authBaseDir)) {
        return 0;
      }
      
      const authDirs = fs.readdirSync(this.authBaseDir);
      const allSessions = await storage.getAllWhatsAppSessions();
      const activeUserIds = new Set(allSessions.filter(s => s.isActive || s.isAuthenticated).map(s => s.userId));
      
      for (const dirName of authDirs) {
        const dirPath = path.join(this.authBaseDir, dirName);
        
        if (!fs.statSync(dirPath).isDirectory()) continue;
        
        // If this user ID doesn't have any active sessions, remove the auth directory
        if (!activeUserIds.has(dirName)) {
          const dirAge = Date.now() - fs.statSync(dirPath).mtime.getTime();
          const oneDayMs = 24 * 60 * 60 * 1000;
          
          // Only remove directories older than 1 day to avoid removing actively used ones
          if (dirAge > oneDayMs) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            console.log(`🗑️ Removed orphaned auth directory: ${dirName}`);
            cleanedCount++;
          }
        }
      }
      
      return cleanedCount;
    } catch (error) {
      console.error('Error cleaning orphaned auth directories:', error);
      return 0;
    }
  }

  private getUserLock(userId: string): PQueue {
    if (!this.userLocks.has(userId)) {
      this.userLocks.set(userId, new PQueue({ concurrency: 1 }));
    }
    return this.userLocks.get(userId)!;
  }

  /**
   * In-place reconnect that reuses same sessionId and authPath
   */
  async reconnectInPlace(userId: string) {
    const s = this.userSessionsByUser.get(userId);
    if (!s) {
      console.log(`⚠️ No session found for reconnection: ${userId}`);
      return;
    }

    // Don't reconnect if already connected or in-flight
    if (s.isConnected || s.status === 'connecting' || s.status === 'restarting') {
      console.log(`⚠️ ${s.userName}: Skipping reconnect - already ${s.status} (connected: ${s.isConnected})`);
      return;
    }

    console.log(`🔄 In-place reconnect for ${s.userName} (user: ${userId}) | Attempt: ${s.reconnectAttempts + 1}`);

    try {
      s.status = 'restarting';
      s.reconnectAttempts++;
      s.lastActivity = new Date();

      // Close old socket if any
      if (s.socket) {
        try {
          s.socket.end(undefined);
        } catch (e) {
          console.log(`⚠️ Error ending old socket: ${(e as Error).message}`);
        }
        s.socket = null;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const { state, saveCreds } = await useMultiFileAuthState(s.authPath);
      const { version } = await fetchLatestBaileysVersion();

      const sock = await this.createSocketForUser(s, state, version, saveCreds);
      s.socket = sock;

      console.log(`🔌 Reconnected ${s.userName} in-place (auth preserved) | Attempt: ${s.reconnectAttempts}`);
    } catch (error) {
      console.error(`❌ In-place reconnect failed for ${s.userName}:`, error);

      s.status = 'disconnected';

      if (s.reconnectAttempts >= this.maxReconnectAttempts) {
        console.log(
          `💀 Max reconnect attempts reached for ${s.userName} (${s.reconnectAttempts}/${this.maxReconnectAttempts})`
        );
        await this.cleanupUserSession(userId);
      } else {
        const backoffDelay = Math.min(60000 * Math.pow(2, s.reconnectAttempts - 1), 300000); // up to 5m
        console.log(`🔄 Scheduling retry for ${s.userName} in ${Math.round(backoffDelay / 1000)}s`);

        clearTimeout(s.reconnectTimeout);
        s.reconnectTimeout = setTimeout(() => this.reconnectInPlace(userId), backoffDelay);
      }
    }
  }

  private async createSocketForUser(
    userSession: UserSession,
    authState: AuthenticationState,
    version: any,
    saveCreds: () => Promise<void>
  ): Promise<WASocket> {
    console.log(`🔌 Creating socket for ${userSession.userName} with persistent auth: ${userSession.authPath}`);

    // Create unique browser identifier to prevent device conflicts
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);
    const uniqueBrowser = [
      `${userSession.clinicName || 'LIMS'}-${userSession.userName}-${timestamp}-${randomId}`, 
      'Chrome', 
      '1.0.0'
    ];

    const socket = makeWASocket({
      version,
      auth: authState,
      printQRInTerminal: false,
      browser: uniqueBrowser, // Use unique browser identifier
      generateHighQualityLinkPreview: false, // Disable to avoid link-preview-js errors
      
      // Complete logger implementation to prevent "logger.error is not a function" errors
      logger: process.env.BAILEYS_LOG_LEVEL === 'error' ? {
        level: 'error',
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        child: () => ({
          level: 'error',
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {}
        })
      } : undefined,
      
      // Ignore problematic message types that cause PreKey errors
      shouldIgnoreJid: (jid: string) => {
        // Ignore status broadcasts and group messages during initial sync
        return (jid.includes('status@broadcast')) || 
               (jid.includes('@g.us') && !userSession.isAuthenticated);
      },
      
      // Handle message failures gracefully
      getMessage: async (key: any) => {
        // Return undefined for messages we can't decrypt (normal behavior)
        return undefined;
      },
      
      // Connection timeouts and retry configuration
      defaultQueryTimeoutMs: parseInt(process.env.WHATSAPP_CONNECTION_TIMEOUT || '60000'),
      connectTimeoutMs: parseInt(process.env.WHATSAPP_CONNECTION_TIMEOUT || '60000'),
      keepAliveIntervalMs: parseInt(process.env.WHATSAPP_KEEP_ALIVE_INTERVAL || '25000'),
      qrTimeout: parseInt(process.env.WHATSAPP_QR_TIMEOUT || '300000'),
      retryRequestDelayMs: 2000, // Increased from 1000 to reduce conflicts
      maxMsgRetryCount: 1, // Reduced from 2 to minimize retry conflicts
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: () => false,
      emitOwnEvents: false,
      fireInitQueries: true,
      transactionOpts: {
        maxCommitRetries: 1, // Reduced from 2 to prevent conflicts
        delayBetweenTriesMs: 2000 // Increased from 1000 to reduce race conditions
      }
    });

    console.log(`🔌 Created socket with unique browser ID: ${uniqueBrowser[0]}`);

    // Connection updates
    socket.ev.on('connection.update', async (update: any) => {
      await this.handleUserConnectionUpdate(userSession.userId, update);
    });

    // Auth creds persistence
    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        console.log(`💾 Saved auth credentials for ${userSession.userName} to ${userSession.authPath}`);
      } catch (error) {
        console.error(`❌ Failed to save auth credentials for ${userSession.userName}:`, error);
      }
    });

    // Incoming messages (with error suppression for PreKey issues)
    socket.ev.on('messages.upsert', async (m) => {
      try {
        await this.handleUserMessages(userSession.userId, m);
      } catch (error: any) {
        // Suppress PreKey and decryption errors (these are normal for new sessions)
        if (error.message?.includes('PreKey') || 
            error.message?.includes('decrypt') ||
            error.message?.includes('No session found')) {
          // These are expected during initial sync, don't log them
          return;
        }
        console.error(`❌ Message handling error for ${userSession.userName}:`, error);
      }
    });

    // Suppress common Baileys errors that are expected behavior
    socket.ev.on('CB:call', () => {
      // Suppress call notifications
    });

    socket.ev.on('CB:chatstate', () => {
      // Suppress typing indicators
    });

    return socket;
  }

  /**
   * Handle user reconnection with exponential backoff and persistent auth reuse
   */
  private async attemptUserReconnection(sessionId: string): Promise<void> {
    const userSession = Array.from(this.userSessionsByUser.values()).find((s) => s.sessionId === sessionId);
    if (!userSession) return;

    userSession.reconnectAttempts++;
    userSession.status = 'restarting';

    const backoffDelay = Math.min(1000 * Math.pow(2, userSession.reconnectAttempts - 1), 30000); // max 30s

    console.log(
      `🔄 Reconnecting ${userSession.userName} (attempt ${userSession.reconnectAttempts}/${this.maxReconnectAttempts}) in ${backoffDelay}ms`
    );

    if (userSession.reconnectTimeout) clearTimeout(userSession.reconnectTimeout);

    userSession.reconnectTimeout = setTimeout(async () => {
      try {
        if (userSession.socket) {
          try {
            userSession.socket.end(undefined);
          } catch (e) {
            console.log(`⚠️ Error ending socket during reconnection:`, (e as Error).message);
          }
          userSession.socket = null;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const { state, saveCreds } = await useMultiFileAuthState(userSession.authPath);
        const { version } = await fetchLatestBaileysVersion();

        const newSocket = await this.createSocketForUser(userSession, state, version, saveCreds);
        userSession.socket = newSocket;

        console.log(`🔌 Recreated socket for ${userSession.userName} using persistent auth: ${userSession.authPath}`);
      } catch (error) {
        console.error(`💥 Reconnection failed for ${userSession.userName}:`, error);

        if (userSession.reconnectAttempts >= this.maxReconnectAttempts) {
          console.log(`💀 Max reconnection attempts reached for ${userSession.userName}`);
          // FIX: cleanup by userId (not sessionId)
          await this.cleanupUserSession(userSession.userId);
        } else {
          await this.attemptUserReconnection(sessionId);
        }
      }
    }, backoffDelay);
  }

  private generateSessionId(): string {
    return crypto.randomUUID();
  }

  /**
   * Create individual WhatsApp session for a specific user
   */
  async createUserSession(
    userId: string,
    strategyName: keyof typeof this.SESSION_STRATEGIES = 'on_demand',
    isReconnection: boolean = false
  ): Promise<{ success: boolean; sessionId?: string; qrCode?: string; error?: string }> {
    const userLock = this.getUserLock(userId);

    return await userLock.add(async () => {
      try {
        console.log(`🔍 GET-OR-CREATE: Checking session for user ${userId}`);

        // In-memory
        const existing = this.userSessionsByUser.get(userId);
        if (existing) {
          console.log(
            `🔍 Found existing session: status=${existing.status}, auth=${existing.isAuthenticated}, connected=${existing.isConnected}`
          );
          if (existing.isAuthenticated && existing.isConnected) {
            console.log(`🔄 Found existing authenticated session for ${existing.userName}: ${existing.sessionId}`);
            return { success: true, sessionId: existing.sessionId };
          }
          if (
            existing.status === 'pairing' ||
            existing.status === 'connecting' ||
            existing.status === 'restarting'
          ) {
            console.log(`🔄 Found existing ${existing.status} session for ${existing.userName}: ${existing.sessionId}`);
            return { success: true, sessionId: existing.sessionId, qrCode: existing.qrCode };
          }
        }

        // DB - with selective cleanup of failed sessions BEFORE checking
        console.log(`🔍 Checking database for user ${userId}...`);
        
        // STEP 1: Get all sessions for this user first
        let dbSessions = await storage.getWhatsAppSessionsByUserId(userId);
        console.log(`🔍 Found ${dbSessions?.length || 0} total DB sessions for user ${userId}`);
        
        // STEP 2: Identify and delete failed sessions (not authenticated OR not active)
        const failedSessions = dbSessions?.filter((s: any) => !s.isAuthenticated || !s.isActive) || [];
        if (failedSessions.length > 0) {
          console.log(`🧹 SELECTIVE CLEANUP: Found ${failedSessions.length} failed sessions to delete`);
          for (const failedSession of failedSessions) {
            await storage.deleteWhatsAppSession(failedSession.id);
            console.log(`🗑️ Deleted failed session: ${failedSession.id} (Auth: ${failedSession.isAuthenticated}, Active: ${failedSession.isActive})`);
          }
          
          // STEP 3: Refresh the session list after cleanup
          dbSessions = await storage.getWhatsAppSessionsByUserId(userId);
          console.log(`🔍 After cleanup: ${dbSessions?.length || 0} remaining DB sessions for user ${userId}`);
        }

        // Exclude 401-failed sessions and validate auth state
        const reusable = dbSessions
          ?.filter((s: any) => 
            s.isAuthenticated && 
            s.isActive && 
            s.sessionData &&
            (!s.lastDisconnectCode || s.lastDisconnectCode !== 401) // Exclude 401 failures
          )
          ?.sort(
            (a: any, b: any) =>
              new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
          )[0];

        if (reusable) {
          console.log(`🔄 Rehydrating session from DB for user ${userId}: ${reusable.id}`);

          let sessionData: any;
          try {
            sessionData = typeof reusable.sessionData === 'string' ? JSON.parse(reusable.sessionData) : reusable.sessionData;
          } catch {
            console.warn(`⚠️ Could not parse sessionData for ${userId}, using default authPath`);
            sessionData = {};
          }

          const authPath = sessionData.authPath || path.join(this.authBaseDir, userId);
          const { state, saveCreds } = await useMultiFileAuthState(authPath);
          const { version } = await fetchLatestBaileysVersion();

          const user = await storage.getUser(userId);
          const userSession: UserSession = {
            userId,
            userName: user?.name ?? 'Unknown',
            clinicName: user?.clinic_name ?? 'Unknown Clinic',
            socket: null,
            isConnected: false,
            isAuthenticated: true, // trust DB; will be confirmed on open
            phoneNumber: reusable.phoneNumber || undefined,
            lastActivity: new Date(reusable.lastActivity || Date.now()),
            qrCode: undefined,
            authPath,
            reconnectAttempts: 0,
            sessionId: reusable.id,
            status: 'restarting',
            isPairing: false
          };

          const socket = await this.createSocketForUser(userSession, state, version, saveCreds);
          userSession.socket = socket;
          this.userSessionsByUser.set(userId, userSession);

          return { success: true, sessionId: reusable.id };
        } else if (dbSessions?.length > 0) {
          console.log(`⚠️ Found ${dbSessions.length} DB sessions but none reusable - will create new session`);
        }

        // New session
        console.log(`🆕 Creating new session for user ${userId}`);

        const enableRateLimiting = process.env.ENABLE_RATE_LIMITING !== 'false';
        if (!isReconnection && enableRateLimiting) {
          const lastAttempt = this.userLastConnectionAttempt.get(userId);
          const now = Date.now();
          const minInterval = parseInt(process.env.RATE_LIMIT_INTERVAL || '15000');

          if (lastAttempt && now - lastAttempt < minInterval) {
            const waitTime = Math.ceil((minInterval - (now - lastAttempt)) / 1000);
            throw new Error(`Rate limited: Please wait ${waitTime} seconds before attempting to connect again`);
          }
          this.userLastConnectionAttempt.set(userId, now);
        } else if (!enableRateLimiting) {
          console.log(`🚀 Rate limiting DISABLED for development - allowing immediate connections`);
        }

        await this.cleanupInactiveSessions();

        const activeSessions = Array.from(this.userSessionsByUser.values()).filter((s) => s.isConnected);
        if (activeSessions.length >= this.maxGlobalSessions) {
          await this.cleanupInactiveSessions();
          const stillActive = Array.from(this.userSessionsByUser.values()).filter((s) => s.isConnected);
          if (stillActive.length >= this.maxGlobalSessions) {
            log(`⚠️ Global session limit reached: ${stillActive.length}/${this.maxGlobalSessions}`);
            throw new Error(
              `Healthcare system at capacity. Active sessions: ${stillActive.length}/${this.maxGlobalSessions}. Please try again in a few minutes.`
            );
          }
        }

        const user = await storage.getUser(userId);
        if (!user) throw new Error(`User ${userId} not found`);

        // If user already has an in-memory session (connected), free it up
        const userActiveSession = this.userSessionsByUser.get(userId);
        const maxUserSessions = parseInt(process.env.WHATSAPP_MAX_SESSIONS_PER_USER || '3');
        if (userActiveSession?.isConnected) {
          await this.cleanupOldestUserSessionForUser(userId);
          log(`🧹 Cleaned up oldest session for user ${user.name} to make room for new connection`);
        }

        const sessionId = this.generateSessionId();
        const authPath = path.join(this.authBaseDir, userId);
        
        // Ensure auth directory exists and validate existing auth state
        fs.mkdirSync(authPath, { recursive: true });
        await this.validateAuthState(userId, authPath);

        const strategy = this.SESSION_STRATEGIES[strategyName];

        const userSession: UserSession = {
          userId,
          userName: user.name,
          clinicName: user.clinic_name || 'Unknown Clinic',
          socket: null,
          isConnected: false,
          isAuthenticated: false,
          lastActivity: new Date(),
          authPath,
          reconnectAttempts: 0,
          sessionId,
          isPairing: false,
          status: 'disconnected'
        };

        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📱 Using WA v${version.join('.')}, isLatest: ${isLatest} for ${user.name}`);

        const socket = await this.createSocketForUser(userSession, state, version, saveCreds);
        userSession.socket = socket;

        this.userSessionsByUser.set(userId, userSession);

        await storage.createWhatsAppSession({
          id: sessionId,
          userId,
          sessionId,
          isActive: true,
          strategy: strategyName,
          sessionData: JSON.stringify({ authPath: `auth/${userId}`, strategy: strategyName }),
          createdAt: new Date(),
          updatedAt: new Date()
        });

        console.log(`🔌 Created WhatsApp session for user: ${user.name} (${user.clinic_name}) - Session: ${sessionId}`);

        return { success: true, sessionId };
      } catch (error: any) {
        console.error(`❌ Failed to create session for user ${userId}:`, error);

        await storage.createSystemLog({
          level: 'error',
          message: `Failed to create WhatsApp session for user ${userId}`,
          service: 'whatsapp',
          userId,
          metadata: { error: (error as Error).message }
        });

        return { success: false, error: (error as Error).message };
      }
    });
  }

  /**
   * Handle connection updates for a specific user
   */
  private async handleUserConnectionUpdate(userId: string, update: any) {
    const s = this.userSessionsByUser.get(userId);
    if (!s) return;

    const { sessionId } = s;
    const { connection, lastDisconnect, qr } = update;
    const code =
      (lastDisconnect?.error as any)?.output?.statusCode ??
      (lastDisconnect?.error as any)?.status ??
      0;

    console.log(
      `📱 ${s.userName}: ${connection || 'unknown'} | QR: ${!!qr} | Code: ${code} | Status: ${s.status} | Attempts: ${s.reconnectAttempts}`
    );

    // 1) QR (only before auth)
    if (qr && !s.isAuthenticated && !s.isPairing) {
      s.isPairing = true;
      s.status = 'pairing';
      s.qrCode = qr;

      const url = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qr)}`;
      await storage.updateUserWhatsAppSession(s.userId, {
        qrCodeData: url,
        updatedAt: new Date()
      });

      this.emit('user-qr-code', {
        sessionId,
        userId: s.userId,
        userName: s.userName,
        clinicName: s.clinicName,
        qrCode: url,
        rawQR: qr
      });

      console.log(`🔲 QR code generated for ${s.userName} - ${s.clinicName}`);
      return;
    }

    // 2) OPEN
    if (connection === 'open') {
      if (s.reconnectTimeout) {
        clearTimeout(s.reconnectTimeout);
        s.reconnectTimeout = undefined;
        console.log(`🔄 Cleared pending reconnect for ${s.userName}`);
      }

      s.isConnected = true;
      s.isAuthenticated = true;
      s.isPairing = false;
      s.status = 'connected';
      s.phoneNumber = s.socket?.user?.id?.split(':')[0];
      s.lastActivity = new Date();
      s.reconnectAttempts = 0;

      await storage.updateUserWhatsAppSession(s.userId, {
        isAuthenticated: true,
        isActive: true,
        phoneNumber: s.phoneNumber,
        lastActivity: new Date(),
        updatedAt: new Date()
      });

      await storage.deactivateOtherUserSessions(s.userId, s.sessionId);

      this.emit('user-connected', {
        sessionId,
        userId: s.userId,
        userName: s.userName,
        clinicName: s.clinicName,
        phoneNumber: s.phoneNumber,
        isAuthenticated: true
      });

      console.log(
        `✅ ${s.userName} (${s.clinicName}) connected! Phone: ${s.phoneNumber} | Attempts reset to 0`
      );
      return;
    }

    // 3) CLOSE
    if (connection === 'close') {
      s.isConnected = false;
      const wasPairing = s.isPairing; // Track if we were in pairing state
      s.isPairing = false;
      s.status = 'disconnected';

      const loggedOut = code === DisconnectReason.loggedOut;
      const restartRequired = code === DisconnectReason.restartRequired || code === 515;
      const connectionLost = code === DisconnectReason.connectionLost;
      const timedOut = code === DisconnectReason.timedOut;
      const serverTerminated = code === 428;
      const connectionReplaced = code === DisconnectReason.connectionReplaced || code === 440;
      const badSession = code === DisconnectReason.badSession || code === 500;

      // For connection replaced or bad session, clear auth state and require fresh QR
      const shouldClearAuth = connectionReplaced || badSession;
      const shouldReconnect = !loggedOut && !connectionReplaced && !badSession && 
        (restartRequired || connectionLost || timedOut || serverTerminated || code === 0);

      if (code === 0 && s.reconnectAttempts >= 2) {
        console.log(
          `⚠️ ${s.userName}: Multiple Code: 0 disconnections (${s.reconnectAttempts}) - using extended delays`
        );
      }

      // Store disconnect code for future reference
      await storage.updateUserWhatsAppSession(s.userId, {
        isAuthenticated: !loggedOut && !shouldClearAuth,
        isActive: shouldReconnect,
        lastDisconnectCode: code,
        updatedAt: new Date()
      });

      // IMMEDIATE DATABASE CLEANUP: Delete failed sessions for specific error codes
      if (loggedOut || connectionReplaced || badSession || code === 401 || code === 440 || code === 500) {
        console.log(`🗑️ IMMEDIATE CLEANUP: Deleting session ${sessionId} due to error code ${code} (${this.getDisconnectReason(code)})`);
        try {
          await storage.deleteWhatsAppSession(sessionId);
          console.log(`✅ Successfully deleted failed session: ${sessionId}`);
          
          await storage.createSystemLog({
            level: 'info',
            message: `Immediately deleted failed WhatsApp session`,
            service: 'whatsapp',
            userId: s.userId,
            metadata: JSON.stringify({ 
              sessionId, 
              disconnectCode: code, 
              reason: this.getDisconnectReason(code),
              userName: s.userName
            })
          });
        } catch (deleteError) {
          console.error(`❌ Failed to delete session ${sessionId}:`, deleteError);
        }
      }

      // Clear auth state for connection conflicts and corrupted sessions
      if (shouldClearAuth) {
        console.log(`🗑️ Code ${code} detected: Clearing auth state for ${s.userName} (${this.getDisconnectReason(code)})`);
        const authPath = path.join(this.authBaseDir, s.userId);
        if (fs.existsSync(authPath)) {
          try {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log(`🗑️ Removed auth directory due to Code ${code}: ${authPath}`);
            
            await storage.createSystemLog({
              level: 'warning',
              message: `Cleared auth state due to Code ${code} (${this.getDisconnectReason(code)})`,
              service: 'whatsapp',
              userId: s.userId,
              metadata: { 
                authPath, 
                sessionId: s.sessionId,
                phoneNumber: s.phoneNumber,
                reason: this.getDisconnectReason(code),
                requiresFreshQR: true
              }
            });
          } catch (error) {
            console.error(`❌ Failed to clear auth directory:`, error);
          }
        }
      }

      // If logged out (401), also clear corrupted auth state
      if (loggedOut) {
        console.log(`🗑️ Code 401 detected: Clearing corrupted auth state for ${s.userName}`);
        const authPath = path.join(this.authBaseDir, s.userId);
        if (fs.existsSync(authPath)) {
          try {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log(`🗑️ Removed corrupted auth directory: ${authPath}`);
            
            await storage.createSystemLog({
              level: 'warning',
              message: `Cleared corrupted auth state due to Code 401`,
              service: 'whatsapp',
              userId: s.userId,
              metadata: { 
                authPath, 
                sessionId: s.sessionId,
                phoneNumber: s.phoneNumber 
              }
            });
          } catch (error) {
            console.error(`❌ Failed to clear auth directory:`, error);
          }
        }
      }

      this.emit('user-disconnected', {
        sessionId,
        userId: s.userId,
        userName: s.userName,
        clinicName: s.clinicName,
        shouldReconnect
      });

      const disconnectReason = this.getDisconnectReason(code);
      console.log(
        `❌ ${s.userName} disconnected. Code: ${code} | Type: ${disconnectReason} | Should reconnect: ${shouldReconnect}`
      );

      if (shouldReconnect && s.reconnectAttempts < this.maxReconnectAttempts) {
        let baseDelay: number;
        let skipJitter = false; // Flag to skip jitter for fast reconnects

        // SPECIAL CASE: Code 515 during QR pairing - immediate reconnect (no delay)
        if (restartRequired && wasPairing && s.reconnectAttempts <= 3) {
          baseDelay = 500; // Just 500ms for instant pairing flow
          skipJitter = true; // No jitter for pairing
          console.log(`⚡ Fast reconnect for ${s.userName} - Code 515 after QR scan (pairing flow)`);
        } else if (code === 0) {
          baseDelay = Math.min(30000 * Math.pow(1.8, s.reconnectAttempts), 600000); // up to 10m
        } else if (restartRequired) {
          baseDelay = 8000;
        } else if (connectionLost || timedOut) {
          baseDelay = Math.min(15000 * Math.pow(1.5, s.reconnectAttempts), 300000); // up to 5m
        } else if (serverTerminated) {
          baseDelay = Math.min(20000 * Math.pow(1.6, s.reconnectAttempts), 360000); // up to 6m
        } else {
          baseDelay = Math.min(10000 * Math.pow(2, s.reconnectAttempts), 120000); // up to 2m
        }

        const jitter = skipJitter ? 0 : Math.random() * 3000;
        const delay = baseDelay + jitter;

        clearTimeout(s.reconnectTimeout);
        s.reconnectTimeout = setTimeout(() => this.reconnectInPlace(userId), delay);

        console.log(
          `🔄 Reconnect scheduled for ${s.userName} in ${Math.round(
            delay / 1000
          )}s (attempt ${s.reconnectAttempts + 1}/${this.maxReconnectAttempts}) | Reason: ${disconnectReason}`
        );
      } else {
        console.log(
          `💀 No reconnection for ${s.userName} - ${loggedOut ? 'logged out' : 'max attempts reached'} | Final attempts: ${s.reconnectAttempts}`
        );
        await this.cleanupUserSession(userId);
      }
    }
  }

  /**
   * Get human-readable disconnect reason for logging
   */
  private getDisconnectReason(code: number): string {
    switch (code) {
      case DisconnectReason.badSession:
        return 'Bad Session';
      case DisconnectReason.connectionClosed:
        return 'Connection Closed';
      case DisconnectReason.connectionLost:
        return 'Connection Lost';
      case DisconnectReason.connectionReplaced:
        return 'Connection Replaced';
      case DisconnectReason.loggedOut:
        return 'Logged Out';
      case DisconnectReason.multideviceMismatch:
        return 'Multi-device Mismatch';
      case DisconnectReason.restartRequired:
        return 'Restart Required';
      case DisconnectReason.timedOut:
        return 'Timed Out';
      case 428:
        return 'Connection Terminated by Server';
      case 440:
        return 'Connection Replaced';
      case 500:
        return 'Bad Session';
      case 515:
        return 'Server Restart';
      case 0:
        return 'Unknown/Clean Close';
      default:
        return `Code ${code}`;
    }
  }

  /**
   * Clear corrupted auth state for a user
   */
  async clearCorruptedAuth(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const userSession = this.userSessionsByUser.get(userId);
      const authPath = path.join(this.authBaseDir, userId);
      
      console.log(`🗑️ Clearing corrupted auth state for user ${userId}`);
      
      // Clean up in-memory session first
      if (userSession) {
        await this.cleanupUserSession(userId);
      }
      
      // Remove corrupted auth directory
      if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log(`🗑️ Removed corrupted auth directory: ${authPath}`);
      }
      
      // Mark all DB sessions as inactive and unauthenticated
      try {
        const dbSessions = await storage.getWhatsAppSessionsByUserId(userId);
        if (dbSessions && dbSessions.length > 0) {
          for (const session of dbSessions) {
            await storage.updateUserWhatsAppSession(userId, {
              isAuthenticated: false,
              isActive: false,
              updatedAt: new Date()
            });
          }
        }
      } catch (error) {
        console.error(`⚠️ Failed to update DB sessions for ${userId}:`, error);
      }
      
      await storage.createSystemLog({
        level: 'info',
        message: `Cleared corrupted auth state for user ${userId}`,
        service: 'whatsapp',
        userId,
        metadata: { authPath, reason: 'Code 401 - Logged Out' }
      });
      
      console.log(`✅ Successfully cleared auth state for user ${userId}`);
      return { 
        success: true, 
        message: `Auth state cleared. User can now connect with fresh QR code.` 
      };
    } catch (error) {
      console.error(`❌ Failed to clear auth for user ${userId}:`, error);
      return { 
        success: false, 
        message: `Failed to clear auth state: ${(error as Error).message}` 
      };
    }
  }

  /**
   * Validate and clean corrupted auth directories
   */
  private async validateAuthState(userId: string, authPath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(authPath)) {
        return true; // No auth state is fine, will generate QR
      }
      
      // Try to load auth state
      const { state } = await useMultiFileAuthState(authPath);
      
      // Check if auth credentials are valid
      if (!state.creds || !state.creds.noiseKey || !state.creds.signedIdentityKey) {
        console.log(`🗑️ Invalid auth credentials detected for ${userId}`);
        fs.rmSync(authPath, { recursive: true, force: true });
        return false;
      }
      
      return true;
    } catch (error) {
      console.log(`🗑️ Corrupted auth state detected for ${userId}, removing...`);
      try {
        fs.rmSync(authPath, { recursive: true, force: true });
      } catch (e) {
        console.error(`❌ Failed to remove corrupted auth:`, e);
      }
      return false;
    }
  }

  /**
   * Handle messages for specific user
   */
  private async handleUserMessages(userId: string, messageUpdate: any) {
    const userSession = this.userSessionsByUser.get(userId);
    if (!userSession) return;

    await storage.createSystemLog({
      level: 'info',
      message: `Message received for ${userSession.userName}`,
      service: 'whatsapp',
      userId: userSession.userId,
      metadata: {
        messageCount: messageUpdate.messages?.length ?? 0,
        sessionId: userSession.sessionId
      }
    });
  }

  /**
   * Send message from specific user
   */
  async sendMessageFromUser(
    userId: string,
    phoneNumber: string,
    content: string,
    templateData?: any
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const userSession = this.userSessionsByUser.get(userId);
      if (!userSession || !userSession.socket || !userSession.isConnected) {
        throw new Error(`User ${userId} does not have an active WhatsApp connection`);
      }

      // Template replacements
      let processedContent = content;
      if (templateData) {
        Object.entries(templateData).forEach(([key, value]) => {
          processedContent = processedContent.replace(new RegExp(`\\[${key}\\]`, 'g'), String(value));
        });
      }

      const result = await userSession.socket.sendMessage(
        phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`,
        { text: processedContent }
      );

      userSession.lastActivity = new Date();

      await storage.createMessage({
        userId,
        sessionId: userSession.sessionId,
        to: phoneNumber,
        content: processedContent,
        type: 'text',
        status: 'sent',
        messageId: result?.key?.id || undefined,
        templateData,
        createdAt: new Date()
      });

      console.log(`📤 Message sent from ${userSession.userName} (${userSession.clinicName}) to ${phoneNumber}`);

      return { success: true, messageId: result?.key?.id || undefined };
    } catch (error: any) {
      console.error(`❌ Failed to send message from user ${userId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send document from specific user
   */
  async sendDocumentFromUser(
    userId: string,
    phoneNumber: string,
    filePath: string,
    caption?: string,
    templateData?: any
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const userSession = this.userSessionsByUser.get(userId);
      if (!userSession || !userSession.socket || !userSession.isConnected) {
        throw new Error(`User ${userId} does not have an active WhatsApp connection`);
      }

      let processedCaption = caption || '';
      if (templateData && caption) {
        Object.entries(templateData).forEach(([key, value]) => {
          processedCaption = processedCaption.replace(new RegExp(`\\[${key}\\]`, 'g'), String(value));
        });
      }

      const result = await userSession.socket.sendMessage(
        phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`,
        {
          document: { url: filePath },
          mimetype: 'application/pdf',
          fileName: path.basename(filePath),
          caption: processedCaption
        }
      );

      userSession.lastActivity = new Date();

      await storage.createMessage({
        userId,
        sessionId: userSession.sessionId,
        to: phoneNumber,
        content: processedCaption,
        type: 'report',
        status: 'sent'
      });

      return {
        success: true,
        messageId: result?.key?.id || undefined
      };

    } catch (error: any) {
      console.error(`❌ Failed to send report for user ${userId}:`, error);
      
      await storage.createSystemLog({
        level: 'error',
        message: `Failed to send WhatsApp report for user ${userId}`,
        service: 'whatsapp',
        userId,
        metadata: { error: error.message, phoneNumber, filePath }
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Disconnect specific user session
   */
  async disconnectUserSession(userId: string): Promise<boolean> {
    try {
      const userSession = this.userSessionsByUser.get(userId);
      if (!userSession) {
        console.log(`⚠️ No session found for user ${userId}`);
        return false;
      }

      if (userSession.socket) {
        await userSession.socket.logout();
      }

      await this.cleanupUserSession(userId);
      console.log(`🔌 Disconnected session for ${userSession.userName} (${userSession.clinicName})`);
      return true;
    } catch (error: any) {
      console.error(`❌ Failed to disconnect session ${userId}:`, error);
      return false;
    }
  }

  /**
   * Disconnect all sessions for a user (single-session model, so same as above)
   */
  async disconnectUser(userId: string): Promise<number> {
    try {
      const userSession = this.userSessionsByUser.get(userId);
      if (!userSession) return 0;

      if (await this.disconnectUserSession(userId)) {
        console.log(`🔌 Disconnected session for user ${userId}`);
        return 1;
      }

      return 0;
    } catch (error: any) {
      console.error(`❌ Failed to disconnect user ${userId}:`, error);
      return 0;
    }
  }

  /**
   * Enhanced cleanup user session with timeout handling
   */
  private async cleanupUserSession(userId: string) {
    const userSession = this.userSessionsByUser.get(userId);
    if (!userSession) return;

    console.log(`🧹 Cleaning up session for ${userSession.userName} (${userId})`);

    try {
      if (userSession.reconnectTimeout) {
        clearTimeout(userSession.reconnectTimeout);
        userSession.reconnectTimeout = undefined;
      }

      if (userSession.socket) {
        try {
          userSession.socket.end(undefined);
        } catch (e: any) {
          console.log(`⚠️ Error ending socket during cleanup:`, e.message || e);
        }
        userSession.socket = null;
      }

      await storage.updateUserWhatsAppSession(userSession.userId, {
        isAuthenticated: false,
        isActive: false,
        updatedAt: new Date()
      });

      this.userSessionsByUser.delete(userId);

      // Auth directory persists (do not delete)
      console.log(`🔒 Preserving auth directory for ${userSession.userName}: ${userSession.authPath}`);
      console.log(`✅ Successfully cleaned up session for ${userSession.userName}`);
    } catch (error) {
      console.error(`❌ Error during session cleanup for ${userSession.userName}:`, error);
    }
  }

  /**
   * Cleanup inactive sessions with configurable timeout
   */
  private async cleanupInactiveSessions() {
    const now = new Date();
    const inactiveThreshold = parseInt(process.env.INACTIVE_SESSION_TIMEOUT || '300000');
    let cleanedCount = 0;

    const sessions = Array.from(this.userSessionsByUser.entries());

    for (const [userId, session] of sessions) {
      const timeSinceLastActivity = now.getTime() - session.lastActivity.getTime();

      if (
        !session.isConnected &&
        session.status !== 'pairing' &&
        session.status !== 'restarting' &&
        timeSinceLastActivity > inactiveThreshold
      ) {
        log(
          `🧹 Cleaning up inactive session for ${session.userName}: ${userId} (inactive for ${Math.round(
            timeSinceLastActivity / 1000
          )}s)`
        );
        await this.cleanupUserSession(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log(`🧹 Cleanup completed: ${cleanedCount} sessions removed. Active sessions: ${this.userSessionsByUser.size}/${this.maxGlobalSessions}`);
    }
  }

  /**
   * Cleanup oldest session for a specific user (single-session model)
   */
  private async cleanupOldestUserSessionForUser(userId: string) {
    const userSession = this.userSessionsByUser.get(userId);
    if (userSession) {
      log(`🧹 Removing existing session for ${userSession.userName}: ${userId}`);
      await this.cleanupUserSession(userId);
    }
  }

  /**
   * Force cleanup all disconnected sessions (admin)
   */
  private async forceCleanupDisconnectedSessions() {
    const sessions = Array.from(this.userSessionsByUser.entries());
    let cleanedCount = 0;

    for (const [userId, session] of sessions) {
      if (!session.isConnected && !session.isAuthenticated) {
        log(`🧹 Force cleaning disconnected session: ${userId} (${session.userName})`);
        await this.cleanupUserSession(userId);
        cleanedCount++;
      }
    }

    log(`🧹 Force cleanup completed: ${cleanedCount} disconnected sessions removed`);
    return cleanedCount;
  }

  /**
   * Reconnect user (create new session)
   */
  private async reconnectUser(userId: string) {
    await this.createUserSession(userId);
  }

  /**
   * Get all active user sessions (single per user)
   */
  getActiveUserSessions(): Array<{
    sessionId: string;
    userId: string;
    userName: string;
    clinicName: string;
    phoneNumber?: string;
    isConnected: boolean;
    lastActivity: Date;
  }> {
    return Array.from(this.userSessionsByUser.values()).map((session) => ({
      sessionId: session.sessionId,
      userId: session.userId,
      userName: session.userName,
      clinicName: session.clinicName,
      phoneNumber: session.phoneNumber,
      isConnected: session.isConnected,
      lastActivity: session.lastActivity
    }));
  }

  /**
   * Get sessions for specific user (single)
   */
  getUserSessions(userId: string): Array<{
    sessionId: string;
    isConnected: boolean;
    phoneNumber?: string;
    lastActivity: Date;
  }> {
    const userSession = this.userSessionsByUser.get(userId);
    if (!userSession) return [];

    return [
      {
        sessionId: userSession.sessionId,
        isConnected: userSession.isConnected,
        phoneNumber: userSession.phoneNumber,
        lastActivity: userSession.lastActivity
      }
    ];
  }

  /**
   * Get specific user session status
   */
  getUserSessionStatus(userId: string):
    | {
        isConnected: boolean;
        phoneNumber?: string;
        lastActivity?: Date;
        userName?: string;
        clinicName?: string;
        status: string;
        reconnectAttempts: number;
        needsReconnection: boolean;
        canReconnect: boolean;
        isAuthenticated: boolean;
      }
    | null {
    const session = this.userSessionsByUser.get(userId);
    if (!session) return null;

    const needsReconnection = !session.isConnected && session.isAuthenticated;
    const canReconnect = session.reconnectAttempts < this.maxReconnectAttempts;

    return {
      isConnected: session.isConnected,
      phoneNumber: session.phoneNumber,
      lastActivity: session.lastActivity,
      userName: session.userName,
      clinicName: session.clinicName,
      status: session.status,
      reconnectAttempts: session.reconnectAttempts,
      needsReconnection,
      canReconnect,
      isAuthenticated: session.isAuthenticated
    };
  }

  /**
   * Initialize service and restore previous sessions
   */
  async initialize() {
    console.log('🚀 Initializing Multi-User WhatsApp Service...');

    try {
      const activeSessions = await storage.getAllActiveWhatsAppSessions();
      console.log(`📱 Found ${activeSessions.length} previous active sessions`);

      for (const session of activeSessions.slice(0, 5)) {
        try {
          console.log(`🔄 Restoring session for user: ${session.userId}`);
          await this.createUserSession(session.userId);
        } catch (error) {
          console.error(`❌ Failed to restore session for user ${session.userId}:`, error);
        }
      }

      console.log('✅ Multi-User WhatsApp Service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Multi-User WhatsApp Service:', error);
    }
  }

  /**
   * Get service statistics
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    connectedSessions: number;
    userBreakdown: Array<{ userId: string; userName: string; sessionCount: number; connectedCount: number }>;
  } {
    const sessions = Array.from(this.userSessionsByUser.values());
    const userStats = new Map<
      string,
      { userName: string; sessionCount: number; connectedCount: number }
    >();

    sessions.forEach((session) => {
      const existing =
        userStats.get(session.userId) || {
          userName: session.userName,
          sessionCount: 0,
          connectedCount: 0
        };

      existing.sessionCount = 1; // single-session model
      if (session.isConnected) existing.connectedCount = 1;

      userStats.set(session.userId, existing);
    });

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.isConnected || s.isAuthenticated).length,
      connectedSessions: sessions.filter((s) => s.isConnected).length,
      userBreakdown: Array.from(userStats.entries()).map(([userId, stats]) => ({
        userId,
        userName: stats.userName,
        sessionCount: stats.sessionCount,
        connectedCount: stats.connectedCount
      }))
    };
  }

  /**
   * Force cleanup all sessions (admin function)
   */
  async forceCleanupAllSessions(): Promise<number> {
    const sessions = Array.from(this.userSessionsByUser.entries());
    let cleanedCount = 0;

    for (const [userId, session] of sessions) {
      if (!session.isAuthenticated) {
        log(`🧹 Force cleaning session: ${userId} (${session.userName})`);
        await this.cleanupUserSession(userId);
        cleanedCount++;
      }
    }

    log(`🧹 Force cleanup completed: ${cleanedCount} sessions removed`);
    return cleanedCount;
  }

  /**
   * Refresh QR code for existing session without creating new session
   */
  async refreshQRCode(userId: string): Promise<{ success: boolean; qrCode?: string; error?: string }> {
    try {
      const userSession = this.userSessionsByUser.get(userId);

      if (!userSession || userSession.isAuthenticated) {
        return {
          success: false,
          error: 'No pending authentication session found for this user. Please create a new session.'
        };
      }

      if (userSession.qrCode) {
        console.log(`📱 Returning existing QR code for ${userSession.userName}`);
        return { success: true, qrCode: userSession.qrCode };
      }

      return { success: false, error: 'No QR code available. Session may need to be recreated.' };
    } catch (error: any) {
      console.error(`❌ Failed to refresh QR for user ${userId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get active session info for a user
   */
  async getUserSessionInfo(userId: string): Promise<{
    success: boolean;
    sessionInfo?: any;
    error?: string;
  }> {
    try {
      const userSession = this.userSessionsByUser.get(userId);

      if (!userSession) {
        return { success: false, error: 'No sessions found for this user' };
      }

      const sessionInfo = [
        {
          sessionId: userSession.sessionId,
          isConnected: userSession.isConnected,
          isAuthenticated: userSession.isAuthenticated,
          phoneNumber: userSession.phoneNumber,
          lastActivity: userSession.lastActivity,
          reconnectAttempts: userSession.reconnectAttempts,
          hasQrCode: !!userSession.qrCode,
          status: userSession.status
        }
      ];

      return { success: true, sessionInfo };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Public cleanup method for admin use
   */
  async adminCleanupInactiveSessions(): Promise<{ cleaned: number; message: string }> {
    const initialCount = this.userSessionsByUser.size;
    await this.cleanupInactiveSessions();
    const finalCount = this.userSessionsByUser.size;
    const cleanedCount = initialCount - finalCount;

    return {
      cleaned: cleanedCount,
      message: `Cleaned up ${cleanedCount} inactive sessions`
    };
  }

  /**
   * Get system summary for admin monitoring
   */
  async getSystemSummary() {
    const sessions = Array.from(this.userSessionsByUser.values());

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.isConnected).length,
      connectedSessions: sessions.filter((s) => s.isAuthenticated).length,
      userBreakdown: this.getUserSessionBreakdown()
    };
  }

  /**
   * Get user session breakdown for monitoring
   */
  private getUserSessionBreakdown() {
    const userStats = new Map<string, any>();

    for (const session of Array.from(this.userSessionsByUser.values())) {
      if (!userStats.has(session.userId)) {
        userStats.set(session.userId, {
          userId: session.userId,
          userName: session.userName,
          sessionCount: 1,
          connectedCount: 0
        });
      }

      const stats = userStats.get(session.userId)!;
      if (session.isAuthenticated) {
        stats.connectedCount = 1;
      }
    }

    return Array.from(userStats.values());
  }
}

// Export singleton instance
export const multiUserWhatsAppService = new MultiUserWhatsAppService();
