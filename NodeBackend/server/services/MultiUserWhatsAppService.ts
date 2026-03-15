import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  WASocket,
  AuthenticationState,
  ConnectionState,
  downloadMediaMessage
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
  userRequestedDisconnect?: boolean; // Track if disconnect was user-initiated
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
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private midnightCheckInterval: NodeJS.Timeout | null = null;
  private lastMidnightCleanup: string | null = null;

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

    // Setup heartbeat to keep sessions alive
    this.setupHeartbeat();

    // Setup midnight IST cleanup for daily session reset
    this.setupMidnightCleanup();

    log(`🚀 Multi-User WhatsApp Service initialized with limits:`);
    log(`   - Max Global Sessions: ${this.maxGlobalSessions}`);
    log(`   - Max Sessions Per User: ${process.env.WHATSAPP_MAX_SESSIONS_PER_USER || 3}`);
    log(`   - Cleanup Interval: ${cleanupInterval / 1000}s`);
    log(`   - Inactive Timeout: ${process.env.INACTIVE_SESSION_TIMEOUT || 300000}ms`);
    log(`   - Daily DB Cleanup: 9:00 PM IST (3:30 PM UTC)`);
    log(`   - Heartbeat: Every 30 minutes`);
    log(`   - Midnight IST Cleanup: 12:00 AM IST daily`);
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
   * Setup internal heartbeat - keeps sessions alive by checking health every 30 minutes
   */
  private setupHeartbeat(): void {
    const intervalMs = 30 * 60 * 1000; // 30 minutes

    this.heartbeatInterval = setInterval(async () => {
      const sessions = Array.from(this.userSessionsByUser.values());
      const activeSessions = sessions.filter(s => s.socket && s.isAuthenticated);
      
      console.log(`💓 Heartbeat: ${activeSessions.length}/${sessions.length} sessions active`);

      for (const session of activeSessions) {
        session.lastActivity = new Date();
        console.log(`💓 ${session.userName}: alive (${session.clinicName})`);
      }

      // Log heartbeat to database
      if (sessions.length > 0) {
        await storage.createSystemLog({
          level: 'info',
          message: `Heartbeat check: ${activeSessions.length} active sessions`,
          service: 'whatsapp',
          metadata: JSON.stringify({
            totalSessions: sessions.length,
            activeSessions: activeSessions.length,
            userNames: activeSessions.map(s => s.userName)
          })
        });
      }
    }, intervalMs);

    console.log('💓 Heartbeat initialized (every 30 minutes)');
  }

  /**
   * Setup midnight IST cleanup - disconnects all sessions once daily at 12:00 AM IST
   * Auth directories are preserved so users can reconnect easily
   */
  private setupMidnightCleanup(): void {
    this.midnightCheckInterval = setInterval(async () => {
      const now = new Date();
      // Convert to IST (UTC + 5:30)
      const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
      const hours = istTime.getUTCHours();
      const minutes = istTime.getUTCMinutes();
      const today = istTime.toISOString().split('T')[0]; // YYYY-MM-DD

      // Trigger at 00:00 IST, only once per day
      if (hours === 0 && minutes === 0 && this.lastMidnightCleanup !== today) {
        this.lastMidnightCleanup = today;
        console.log('🕛 Midnight IST - Starting daily session cleanup...');
        await this.performMidnightCleanup();
      }
    }, 60 * 1000); // Check every minute

    console.log('🕐 Midnight cleanup scheduled (12:00 AM IST daily)');
  }

  /**
   * Perform midnight cleanup - disconnect all sessions, preserve auth
   */
  private async performMidnightCleanup(): Promise<void> {
    const activeSessions = Array.from(this.userSessionsByUser.values())
      .filter(s => s.socket && s.isAuthenticated);

    await storage.createSystemLog({
      level: 'info',
      message: `Daily midnight cleanup started: ${activeSessions.length} sessions`,
      service: 'whatsapp',
      metadata: JSON.stringify({
        sessionCount: activeSessions.length,
        userNames: activeSessions.map(s => s.userName),
        trigger: 'midnight_ist_cleanup'
      })
    });

    if (activeSessions.length === 0) {
      console.log('🕛 No active sessions to cleanup at midnight');
      return;
    }

    console.log(`🕛 Disconnecting ${activeSessions.length} sessions for daily cleanup...`);

    for (const session of activeSessions) {
      try {
        console.log(`🕛 Disconnecting ${session.userName} (${session.clinicName}) for daily cleanup...`);
        
        if (session.reconnectTimeout) {
          clearTimeout(session.reconnectTimeout);
          session.reconnectTimeout = undefined;
        }

        if (session.socket) {
          session.socket.end(undefined);
          session.socket = null;
        }

        // Update database - mark inactive but preserve session
        await storage.updateUserWhatsAppSession(session.userId, {
          isActive: false,
          isAuthenticated: false,
          updatedAt: new Date()
        });

        // Emit disconnect event
        this.emit('user-disconnected', {
          sessionId: session.sessionId,
          userId: session.userId,
          userName: session.userName,
          clinicName: session.clinicName,
          shouldReconnect: false,
          reason: 'daily_midnight_cleanup'
        });

      } catch (error) {
        console.error(`🕛 Error disconnecting ${session.userName}:`, error);
      }
    }

    // Clear in-memory sessions
    this.userSessionsByUser.clear();

    console.log('🕛 Daily midnight cleanup completed. Auth preserved - users can reconnect.');

    await storage.createSystemLog({
      level: 'info',
      message: 'Daily midnight cleanup completed',
      service: 'whatsapp',
      metadata: JSON.stringify({
        sessionsDisconnected: activeSessions.length,
        completedAt: new Date().toISOString()
      })
    });
  }

  /**
   * Get health status of all sessions - for external monitoring
   */
  getSessionsHealth(): Array<{
    userId: string;
    userName: string;
    clinicName: string;
    isConnected: boolean;
    isAuthenticated: boolean;
    lastActivity: Date;
    phoneNumber: string | undefined;
    sessionId: string;
    status: string;
  }> {
    return Array.from(this.userSessionsByUser.values()).map(s => ({
      userId: s.userId,
      userName: s.userName,
      clinicName: s.clinicName,
      isConnected: s.isConnected,
      isAuthenticated: s.isAuthenticated,
      lastActivity: s.lastActivity,
      phoneNumber: s.phoneNumber,
      sessionId: s.sessionId,
      status: s.status
    }));
  }

  /**
   * Pulse check for specific user - external apps can call to verify session is alive
   */
  async pulseCheck(userId: string): Promise<{
    alive: boolean;
    userId: string;
    userName?: string;
    clinicName?: string;
    isAuthenticated: boolean;
    lastActivity: Date | null;
    phoneNumber: string | undefined;
    status: string;
  }> {
    const session = this.userSessionsByUser.get(userId);

    if (!session) {
      return {
        alive: false,
        userId,
        isAuthenticated: false,
        lastActivity: null,
        phoneNumber: undefined,
        status: 'not_found'
      };
    }

    // Update last activity on pulse
    session.lastActivity = new Date();

    return {
      alive: !!session.socket && session.isConnected,
      userId: session.userId,
      userName: session.userName,
      clinicName: session.clinicName,
      isAuthenticated: session.isAuthenticated,
      lastActivity: session.lastActivity,
      phoneNumber: session.phoneNumber,
      status: session.status
    };
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

    // Create stable per-user browser identifier (consistent across reconnections)
    // Use userId hash to keep it stable but unique per user
    const userHash = userSession.userId.substring(0, 8);
    const uniqueBrowser = [
      `${userSession.clinicName || 'LIMS'}-${userSession.userName}-${userHash}`,
      'Chrome',
      '10.0'
    ];

    const socket = makeWASocket({
      version,
      auth: authState,
      printQRInTerminal: false,
      browser: uniqueBrowser,
      generateHighQualityLinkPreview: false,
      
      // Silent logger with child support
      logger: {
        level: 'silent',
        fatal: () => {},
        error: () => {},
        warn: () => {},
        info: () => {},
        debug: () => {},
        trace: () => {},
        child: () => ({
          level: 'silent',
          fatal: () => {},
          error: () => {},
          warn: () => {},
          info: () => {},
          debug: () => {},
          trace: () => {}
        })
      } as any,
      
      // Handle message failures gracefully
      getMessage: async (key: any) => {
        return undefined;
      },
      
      // Optimized connection settings for stability
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000, // Increased from 25s to 30s
      qrTimeout: 60000, // 60 seconds for QR scan
      retryRequestDelayMs: 3000, // Increased to 3s
      maxMsgRetryCount: 3,
      
      // Critical stability settings
      markOnlineOnConnect: true, // Changed to true to maintain presence
      syncFullHistory: false,
      fireInitQueries: true,
      
      // Simplified transaction options
      transactionOpts: {
        maxCommitRetries: 3,
        delayBetweenTriesMs: 3000
      },
      
      // Add mobile flag for better compatibility
      mobile: false,
      
      // Proper message handling
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: (jid: string) => jid.includes('status@broadcast'),
      
      // Patch socket options for better stability
      patchMessageBeforeSending: (msg: any) => {
        return msg;
      }
    });

    console.log(`🔌 Created socket with browser ID: ${uniqueBrowser.join(' ')}`);

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
      // If this is a user-requested disconnect, skip auto-reconnect logic
      if (s.userRequestedDisconnect) {
        console.log(`🔌 Skipping auto-reconnect logic - user requested disconnect for ${s.userName}`);
        return;
      }

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

      // ONLY clear auth for connection replaced (440) - preserve auth for Code 500 to allow retry
      const shouldClearAuth = connectionReplaced;  // NOT badSession - Code 500 should preserve auth
      
      // Code 500 (Bad Session) SHOULD reconnect - preserve auth and retry
      const shouldReconnect = !loggedOut && !connectionReplaced && 
        (restartRequired || connectionLost || timedOut || serverTerminated || badSession || code === 0);

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

      // IMMEDIATE DATABASE CLEANUP: Only delete for explicit logout (401) or connection replaced (440)
      // Code 500 (Bad Session) should mark inactive but allow retry
      if (loggedOut || connectionReplaced || code === 401 || code === 440) {
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
      } else if (badSession || code === 500) {
        // Code 500 - DO NOT mark inactive, allow automatic reconnection
        console.log(`⚠️ Code 500 (Bad Session) detected for ${s.userName} - will attempt reconnection (auth preserved)`);
        
        await storage.createSystemLog({
          level: 'warning',
          message: `Code 500 (Bad Session) - reconnection will be attempted`,
          service: 'whatsapp',
          userId: s.userId,
          metadata: JSON.stringify({ 
            sessionId, 
            disconnectCode: code, 
            reason: 'Bad Session - Auto Reconnect',
            userName: s.userName,
            shouldReconnect: true
          })
        });
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

        // SPECIAL CASE: fast reconnect during QR pairing so stale QR codes are replaced immediately
        if ((restartRequired || code === 0) && wasPairing && s.reconnectAttempts <= 3) {
          baseDelay = 500; // Just 500ms for instant pairing flow
          skipJitter = true; // No jitter for pairing
          console.log(`? Fast reconnect for ${s.userName} - code ${code} during pairing`);
        } else if (badSession || code === 500) {
          // Code 500 (Bad Session) - reconnect with moderate delay
          baseDelay = Math.min(10000 * Math.pow(1.5, s.reconnectAttempts), 180000); // 10s, 15s, 22s... up to 3m
          console.log(`🔄 Code 500 reconnect for ${s.userName} - preserving auth, delay: ${Math.round(baseDelay/1000)}s`);
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

    const messages = messageUpdate?.messages || [];
    for (const msg of messages) {
      try {
        const payload = await this.buildIncomingWebhookPayload(userId, msg);
        if (!payload) continue;
        await this.forwardIncomingWebhook(payload);
      } catch (error) {
        console.error(`? Failed to forward incoming message for ${userSession.userName}:`, error);
      }
    }
  }

  private async buildIncomingWebhookPayload(userId: string, msg: any) {
    if (!msg?.message || msg.key?.fromMe) return null;

    const from = msg.key?.remoteJid as string | undefined;
    if (!from || from.includes('status@broadcast')) return null;

    const senderPn = (msg.key as any)?.senderPn as string | undefined;
    const phoneNumber = String((senderPn || from.split('@')[0] || '').replace(/\D/g, ''));
    if (!phoneNumber) return null;

    const timestamp = typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp * 1000
      : Date.now();

    if (msg.message.interactiveResponseMessage) {
      const res = msg.message.interactiveResponseMessage.nativeFlowResponseMessage;
      let buttonId = '[Interactive Response]';
      try {
        buttonId = res?.paramsJson ? JSON.parse(res.paramsJson)?.id || buttonId : buttonId;
      } catch {}

      return {
        userId,
        sessionName: 'default',
        phoneNumber,
        content: String(buttonId),
        from,
        senderPn,
        timestamp,
        messageType: 'interactive',
      };
    }

    if (msg.message.audioMessage) {
      const audioMsg = msg.message.audioMessage;
      const isVoiceNote = audioMsg.ptt === true;
      let audioData: string | undefined;

      try {
        const audioBuffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer;
        audioData = audioBuffer.toString('base64');
      } catch {}

      return {
        userId,
        sessionName: 'default',
        phoneNumber,
        content: isVoiceNote ? '[Voice Note]' : '[Audio Message]',
        from,
        senderPn,
        timestamp,
        messageType: isVoiceNote ? 'voice_note' : 'audio',
        mediaInfo: {
          mimetype: audioMsg.mimetype || 'audio/ogg',
          seconds: audioMsg.seconds,
          fileLength: audioMsg.fileLength,
        },
        audioData,
      };
    }

    if (msg.message.imageMessage) {
      return {
        userId,
        sessionName: 'default',
        phoneNumber,
        content: msg.message.imageMessage.caption || '[Image]',
        from,
        senderPn,
        timestamp,
        messageType: 'image',
      };
    }

    if (msg.message.documentMessage) {
      return {
        userId,
        sessionName: 'default',
        phoneNumber,
        content: `[Document: ${msg.message.documentMessage.fileName || 'file'}]`,
        from,
        senderPn,
        timestamp,
        messageType: 'document',
      };
    }

    if (msg.message.videoMessage) {
      return {
        userId,
        sessionName: 'default',
        phoneNumber,
        content: msg.message.videoMessage.caption || '[Video]',
        from,
        senderPn,
        timestamp,
        messageType: 'video',
      };
    }

    const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (!messageText) return null;

    return {
      userId,
      sessionName: 'default',
      phoneNumber,
      content: messageText,
      from,
      senderPn,
      timestamp,
      messageType: 'text',
    };
  }

  private async forwardIncomingWebhook(payload: any) {
    const webhookUrl =
      process.env.INCOMING_MESSAGE_WEBHOOK_URL ||
      process.env.CURRENT_APP_INCOMING_WEBHOOK_URL;

    if (!webhookUrl) {
      return;
    }

    const apiKey =
      process.env.WHATSAPP_SYNC_API_KEY ||
      process.env.API_KEY ||
      'whatsapp-lims-secure-api-key-2024';

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Incoming webhook failed (${response.status}): ${responseText}`);
    }
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
   * Disconnect specific user session with proper logging and events
   */
  async disconnectUserSession(userId: string): Promise<boolean> {
    try {
      const userSession = this.userSessionsByUser.get(userId);
      if (!userSession) {
        console.log(`⚠️ No session found for user ${userId}`);
        return false;
      }

      const userName = userSession.userName;
      const clinicName = userSession.clinicName;
      const sessionId = userSession.sessionId;

      console.log(`🔌 User requested disconnect for ${userName} (${clinicName})`);

      // Set flag to prevent auto-reconnect logic
      userSession.userRequestedDisconnect = true;

      // Clear reconnect timeout
      if (userSession.reconnectTimeout) {
        clearTimeout(userSession.reconnectTimeout);
        userSession.reconnectTimeout = undefined;
      }

      // Close socket gracefully
      if (userSession.socket) {
        try {
          userSession.socket.end(undefined);
        } catch (e: any) {
          console.log(`⚠️ Error ending socket:`, e.message || e);
        }
        userSession.socket = null;
      }

      // Update database - mark inactive
      await storage.updateUserWhatsAppSession(userId, {
        isAuthenticated: false,
        isActive: false,
        updatedAt: new Date()
      });

      // Emit disconnect event for frontend
      this.emit('user-disconnected', {
        sessionId,
        userId,
        userName,
        clinicName,
        shouldReconnect: false,
        reason: 'user_requested_disconnect'
      });

      // Log to system logs
      await storage.createSystemLog({
        level: 'info',
        message: 'User actively disconnected WhatsApp session',
        service: 'whatsapp',
        userId,
        sessionId,
        metadata: JSON.stringify({
          userName,
          clinicName,
          reason: 'user_requested_disconnect',
          authPreserved: true
        })
      });

      // Remove from memory
      this.userSessionsByUser.delete(userId);

      // Preserve auth directory
      console.log(`🔒 Auth preserved for ${userName}: ${userSession.authPath}`);
      console.log(`✅ Successfully disconnected ${userName}`);
      
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


