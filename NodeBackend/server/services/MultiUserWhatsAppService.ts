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
  private userSessionsByUser: Map<string, UserSession> = new Map(); // Key by userId for robustness
  private readonly authBaseDir = './auth'; // Persistent auth storage per user
  private readonly maxReconnectAttempts = 5;
  private readonly maxGlobalSessions = 15;
  private userLocks = new Map<string, PQueue>(); // Per-user mutex locks
  private userLastConnectionAttempt: Map<string, number> = new Map(); // Track last connection attempt per user

  private readonly SESSION_STRATEGIES: Record<string, SessionStrategy> = {
    business_hours: {
      name: 'business_hours',
      duration: 8 * 60 * 60 * 1000, // 8 hours
      autoReconnect: true,
      maxReconnectAttempts: 5,
      businessHoursOnly: true
    },
    always_on: {
      name: 'always_on',
      duration: 24 * 60 * 60 * 1000, // 24 hours
      autoReconnect: true,
      maxReconnectAttempts: 10,
      businessHoursOnly: false
    },
    on_demand: {
      name: 'on_demand',
      duration: 2 * 60 * 60 * 1000, // 2 hours
      autoReconnect: false,
      maxReconnectAttempts: 3,
      businessHoursOnly: false
    }
  };

  constructor() {
    super();
    this.ensureAuthDirectory();
    
    // Clean up inactive sessions with configurable interval
    const cleanupInterval = parseInt(process.env.SESSION_CLEANUP_INTERVAL || '300000'); // 5 minutes default
    setInterval(() => this.cleanupInactiveSessions(), cleanupInterval);
    
    log(`🚀 Multi-User WhatsApp Service initialized with limits:`);
    log(`   - Max Global Sessions: ${this.maxGlobalSessions}`);
    log(`   - Max Sessions Per User: ${process.env.WHATSAPP_MAX_SESSIONS_PER_USER || 3}`);
    log(`   - Cleanup Interval: ${cleanupInterval/1000}s`);
    log(`   - Inactive Timeout: ${process.env.INACTIVE_SESSION_TIMEOUT || 300000}ms`);
  }

  private ensureAuthDirectory() {
    if (!fs.existsSync(this.authBaseDir)) {
      fs.mkdirSync(this.authBaseDir, { recursive: true });
    }
  }

  private getUserLock(userId: string): PQueue {
    if (!this.userLocks.has(userId)) {
      this.userLocks.set(userId, new PQueue({ concurrency: 1 }));
    }
    return this.userLocks.get(userId)!;
  }

  /**
   * In-place reconnect that reuses same sessionId and authPath - NO new session creation
   */
  private async reconnectInPlace(userId: string) {
    const s = this.userSessionsByUser.get(userId);
    if (!s) return;

    console.log(`🔄 In-place reconnect for ${s.userName} (user: ${userId})`);

    try {
      // Close old socket if any
      if (s.socket) {
        try { 
          s.socket.end(undefined); 
        } catch (e) {
          console.log(`⚠️ Error ending old socket: ${(e as Error).message}`);
        }
        s.socket = null;
      }

      // Reuse same authPath - this is key for persistent auth
      const { state, saveCreds } = await useMultiFileAuthState(s.authPath);
      const { version } = await fetchLatestBaileysVersion();
      
      s.status = 'restarting';
      s.reconnectAttempts++;
      s.lastActivity = new Date();

      // Create new socket with existing session data
      const sock = await this.createSocketForUser(s, state, version, saveCreds);
      s.socket = sock;

      console.log(`🔌 Reconnected ${s.userName} in-place (auth preserved)`);

    } catch (error) {
      console.error(`❌ In-place reconnect failed for ${s.userName}:`, error);
      
      // If max attempts reached, cleanup
      if (s.reconnectAttempts >= this.maxReconnectAttempts) {
        await this.cleanupUserSession(userId);
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

    const socket = makeWASocket({
      version,
      auth: authState,
      printQRInTerminal: false,
      browser: [`${userSession.clinicName || 'LIMS'}-${userSession.userName}`, 'Chrome', '1.0.0'],
      generateHighQualityLinkPreview: true,
      // Enhanced timeout configuration
      defaultQueryTimeoutMs: parseInt(process.env.WHATSAPP_CONNECTION_TIMEOUT || '60000'),
      connectTimeoutMs: parseInt(process.env.WHATSAPP_CONNECTION_TIMEOUT || '60000'),
      keepAliveIntervalMs: parseInt(process.env.WHATSAPP_KEEP_ALIVE_INTERVAL || '30000'),
      qrTimeout: parseInt(process.env.WHATSAPP_QR_TIMEOUT || '300000'),
      retryRequestDelayMs: 500,
      maxMsgRetryCount: 3,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: () => false,
      getMessage: async () => undefined
    });

    // Handle connection updates with proper pairing state tracking
    socket.ev.on('connection.update', async (update: any) => {
      await this.handleUserConnectionUpdate(userSession.userId, update);
    });

    // Handle credentials update - CRITICAL for persistent auth
    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        console.log(`💾 Saved auth credentials for ${userSession.userName} to ${userSession.authPath}`);
      } catch (error) {
        console.error(`❌ Failed to save auth credentials for ${userSession.userName}:`, error);
      }
    });

    // Handle messages for this user
    socket.ev.on('messages.upsert', async (m) => {
      await this.handleUserMessages(userSession.userId, m);
    });

    return socket;
  }

  /**
   * Handle user reconnection with exponential backoff and persistent auth reuse
   */
  private async attemptUserReconnection(sessionId: string): Promise<void> {
    const userSession = this.userSessions.get(sessionId);
    if (!userSession) return;

    userSession.reconnectAttempts++;
    userSession.status = 'restarting';

    const backoffDelay = Math.min(1000 * Math.pow(2, userSession.reconnectAttempts - 1), 30000); // Max 30s
    
    console.log(`🔄 Reconnecting ${userSession.userName} (attempt ${userSession.reconnectAttempts}/${this.maxReconnectAttempts}) in ${backoffDelay}ms`);

    // Clear any existing timeout
    if (userSession.reconnectTimeout) {
      clearTimeout(userSession.reconnectTimeout);
    }

    userSession.reconnectTimeout = setTimeout(async () => {
      try {
        // Clean up old socket
        if (userSession.socket) {
          try {
            userSession.socket.end(undefined);
          } catch (e) {
            console.log(`⚠️ Error ending socket during reconnection:`, (e as Error).message);
          }
          userSession.socket = null;
        }

        // Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Recreate socket using SAME auth directory (persistent auth)
        const { state, saveCreds } = await useMultiFileAuthState(userSession.authPath);
        const { version } = await fetchLatestBaileysVersion();

        const newSocket = await this.createSocketForUser(userSession, state, version, saveCreds);
        userSession.socket = newSocket;

        console.log(`🔌 Recreated socket for ${userSession.userName} using persistent auth: ${userSession.authPath}`);

      } catch (error) {
        console.error(`💥 Reconnection failed for ${userSession.userName}:`, error);
        
        if (userSession.reconnectAttempts >= this.maxReconnectAttempts) {
          console.log(`💀 Max reconnection attempts reached for ${userSession.userName}`);
          await this.cleanupUserSession(sessionId);
        } else {
          // Try again with longer delay
          await this.attemptUserReconnection(sessionId);
        }
      }
    }, backoffDelay);
  }

  private generateSessionId(userId: string): string {
    // Generate a proper UUID instead of the composite string
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
    // Use per-user mutex to prevent concurrent session creation
    const userLock = this.getUserLock(userId);
    
    return await userLock.add(async () => {
      try {
        // Check if user already has a session - keyed by userId for robustness
        const existingSession = this.userSessionsByUser.get(userId);
        
        if (existingSession && !isReconnection) {
          const { status, isConnected, sessionId, qrCode } = existingSession;
          
          // Guard against states: pairing, restarting, connected
          if (status === 'pairing' || status === 'restarting' || status === 'connected' || isConnected) {
            console.log(`🔄 User ${userId} already has active session: ${sessionId} (${status})`);
            return {
              success: true,
              sessionId,
              qrCode
            };
          }
        }
      // Rate limiting: Only apply to new connections, not reconnections (can be disabled for dev)
      const enableRateLimiting = process.env.ENABLE_RATE_LIMITING !== 'false';
      
      if (!isReconnection && enableRateLimiting) {
        const lastAttempt = this.userLastConnectionAttempt.get(userId);
        const now = Date.now();
        const minInterval = parseInt(process.env.RATE_LIMIT_INTERVAL || '15000'); // 15 seconds default
        
        if (lastAttempt && (now - lastAttempt) < minInterval) {
          const waitTime = Math.ceil((minInterval - (now - lastAttempt)) / 1000);
          throw new Error(`Rate limited: Please wait ${waitTime} seconds before attempting to connect again`);
        }
        
        this.userLastConnectionAttempt.set(userId, now);
      }
      
      // Log rate limiting status for debugging
      if (!enableRateLimiting) {
        console.log(`🚀 Rate limiting DISABLED for development - allowing immediate connections`);
      }
      
      // Cleanup inactive sessions first to free up space
      await this.cleanupInactiveSessions();

      // Check global session limit after cleanup
      const activeSessions = Array.from(this.userSessionsByUser.values()).filter(s => s.isConnected);
      if (activeSessions.length >= this.maxGlobalSessions) {
        // Try to cleanup disconnected sessions aggressively
        await this.cleanupInactiveSessions();
        
        // Recheck after aggressive cleanup
        const stillActiveSessions = Array.from(this.userSessionsByUser.values()).filter(s => s.isConnected);
        if (stillActiveSessions.length >= this.maxGlobalSessions) {
          log(`⚠️ Global session limit reached: ${stillActiveSessions.length}/${this.maxGlobalSessions}`);
          throw new Error(`Healthcare system at capacity. Active sessions: ${stillActiveSessions.length}/${this.maxGlobalSessions}. Please try again in a few minutes.`);
        }
      }

      // Get user from database
      const user = await storage.getUser(userId);
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Check if user already has active sessions
      const userActiveSessions = Array.from(this.userSessionsByUser.values())
        .filter(session => session.userId === userId && session.isConnected);
      
      const maxUserSessions = parseInt(process.env.WHATSAPP_MAX_SESSIONS_PER_USER || '3');
      if (userActiveSessions.length >= maxUserSessions) {
        // Cleanup oldest user session to make room
        await this.cleanupOldestUserSessionForUser(userId);
        log(`🧹 Cleaned up oldest session for user ${user.name} to make room for new connection`);
      }

      // Create persistent auth directory for this user
      const sessionId = this.generateSessionId(userId);
      const authPath = path.join(this.authBaseDir, userId);
      fs.mkdirSync(authPath, { recursive: true });

      const strategy = this.SESSION_STRATEGIES[strategyName];

      // Initialize user session
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

      // Create Baileys auth state for this user
      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      // Get latest Baileys version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`📱 Using WA v${version.join('.')}, isLatest: ${isLatest} for ${user.name}`);

      // Create socket with persistent auth pattern and proper connection handling  
      const socket = await this.createSocketForUser(userSession, state, version, saveCreds);
      userSession.socket = socket;
      
      // Store session keyed by userId for robustness
      this.userSessionsByUser.set(userId, userSession);

      // Save session to database
      await storage.createWhatsAppSession({
        id: sessionId,
        userId,
        sessionId,
        isActive: true,
        strategy: strategyName,
        sessionData: { authPath, strategy: strategyName },
        createdAt: new Date(),
        updatedAt: new Date()
      });

      console.log(`🔌 Created WhatsApp session for user: ${user.name} (${user.clinic_name}) - Session: ${sessionId}`);
      
      // Return immediately - events will deliver QR/connected status via WebSocket
      return {
        success: true,
        sessionId
      };

    } catch (error: any) {
      console.error(`❌ Failed to create session for user ${userId}:`, error);
      
      await storage.createSystemLog({
        level: 'error',
        message: `Failed to create WhatsApp session for user ${userId}`,
        service: 'whatsapp',
        userId,
        metadata: { error: (error as Error).message }
      });

      return {
        success: false,
        error: (error as Error).message
      };
      }
    });
  }

  /**
   * Handle connection updates for specific user - Clean single state machine
   */
  private async handleUserConnectionUpdate(userId: string, update: any) {
    const s = this.userSessionsByUser.get(userId);
    if (!s) return;
    
    const { sessionId } = s; // Get sessionId from stored session

    const { connection, lastDisconnect, qr } = update;
    const code = (lastDisconnect?.error as any)?.output?.statusCode ?? 
                 (lastDisconnect?.error as any)?.status ?? 0;

    console.log(`📱 ${s.userName}: ${connection || 'unknown'} | QR: ${!!qr} | Code: ${code} | Status: ${s.status}`);

    // 1) QR: only before auth
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

    // 2) OPEN: mark authenticated and stop QR forever
    if (connection === 'open') {
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
      
      this.emit('user-connected', { 
        sessionId, 
        userId: s.userId, 
        userName: s.userName, 
        clinicName: s.clinicName, 
        phoneNumber: s.phoneNumber, 
        isAuthenticated: true 
      });
      
      console.log(`✅ ${s.userName} (${s.clinicName}) connected! Phone: ${s.phoneNumber}`);
      return;
    }

    // 3) CLOSE: compute strategy
    if (connection === 'close') {
      s.isConnected = false;
      s.isPairing = false;
      s.status = 'disconnected';

      const loggedOut = code === DisconnectReason.loggedOut;
      const restartRequired = code === DisconnectReason.restartRequired || code === 515;
      const shouldReconnect = !loggedOut;

      await storage.updateUserWhatsAppSession(s.userId, { 
        isAuthenticated: !loggedOut, 
        isActive: shouldReconnect, 
        updatedAt: new Date() 
      });
      
      this.emit('user-disconnected', { 
        sessionId, 
        userId: s.userId, 
        userName: s.userName, 
        clinicName: s.clinicName, 
        shouldReconnect 
      });

      console.log(`❌ ${s.userName} disconnected. Code: ${code} | Should reconnect: ${shouldReconnect}`);

      if (shouldReconnect && s.reconnectAttempts < this.maxReconnectAttempts) {
        const base = restartRequired ? 3000 : 10000;
        const delay = Math.min(base * Math.pow(2, s.reconnectAttempts) + Math.random()*2000, 120000);
        
        clearTimeout(s.reconnectTimeout);
        s.reconnectTimeout = setTimeout(() => this.reconnectInPlace(userId), delay);
        
        console.log(`🔄 Reconnect scheduled for ${s.userName} in ${Math.round(delay/1000)}s (attempt ${s.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
      } else {
        console.log(`� No reconnection for ${s.userName} - ${loggedOut ? 'logged out' : 'max attempts reached'}`);
        await this.cleanupUserSession(sessionId);
      }
    }
  }

  /**
   * Handle messages for specific user
   */
  private async handleUserMessages(userId: string, messageUpdate: any) {
    const userSession = this.userSessionsByUser.get(userId);
    if (!userSession) return;

    // Log received messages for this user
    await storage.createSystemLog({
      level: 'info',
      message: `Message received for ${userSession.userName}`,
      service: 'whatsapp',
      userId: userSession.userId,
      metadata: { 
        messageCount: messageUpdate.messages.length,
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
      // Find active session for this user - keyed by userId
      const userSession = this.userSessionsByUser.get(userId);

      if (!userSession || !userSession.socket || !userSession.isConnected) {
        throw new Error(`User ${userId} does not have an active WhatsApp connection`);
      }

      // Process template data
      let processedContent = content;
      if (templateData) {
        Object.entries(templateData).forEach(([key, value]) => {
          processedContent = processedContent.replace(new RegExp(`\\[${key}\\]`, 'g'), String(value));
        });
      }

      // Send message using user's WhatsApp connection
      const result = await userSession.socket.sendMessage(
        phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`,
        { text: processedContent }
      );

      // Update user activity
      userSession.lastActivity = new Date();

      // Save message to database
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

      return {
        success: true,
        messageId: result?.key?.id || undefined
      };

    } catch (error: any) {
      console.error(`❌ Failed to send message from user ${userId}:`, error);
      return {
        success: false,
        error: error.message
      };
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
      // Find active session for this user - keyed by userId
      const userSession = this.userSessionsByUser.get(userId);

      if (!userSession || !userSession.socket || !userSession.isConnected) {
        throw new Error(`User ${userId} does not have an active WhatsApp connection`);
      }

      // Process template data in caption
      let processedCaption = caption || '';
      if (templateData && caption) {
        Object.entries(templateData).forEach(([key, value]) => {
          processedCaption = processedCaption.replace(new RegExp(`\\[${key}\\]`, 'g'), String(value));
        });
      }

      // Send document using user's WhatsApp connection
      const result = await userSession.socket.sendMessage(
        phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`,
        {
          document: { url: filePath },
          mimetype: 'application/pdf',
          fileName: path.basename(filePath),
          caption: processedCaption
        }
      );

      // Update user activity
      userSession.lastActivity = new Date();

      // Save message to database
      await storage.createMessage({
        userId,
        sessionId: userSession.sessionId,
        to: phoneNumber,
        content: processedCaption,
        type: 'document',
        status: 'sent',
        messageId: result?.key?.id || undefined,
        filePath,
        templateData,
        createdAt: new Date()
      });

      console.log(`📎 Document sent from ${userSession.userName} (${userSession.clinicName}) to ${phoneNumber}`);

      return {
        success: true,
        messageId: result?.key?.id || undefined
      };

    } catch (error: any) {
      console.error(`❌ Failed to send document from user ${userId}:`, error);
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
   * Disconnect all sessions for a user
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
      // Clear any reconnect timeout
      if (userSession.reconnectTimeout) {
        clearTimeout(userSession.reconnectTimeout);
        userSession.reconnectTimeout = undefined;
      }

      // Close socket if exists
      if (userSession.socket) {
        try {
          userSession.socket.end(undefined);
        } catch (e: any) {
          console.log(`⚠️ Error ending socket during cleanup:`, e.message || e);
        }
        userSession.socket = null;
      }

      // Update database
      await storage.updateUserWhatsAppSession(userSession.userId, {
        isAuthenticated: false,
        isActive: false,
        updatedAt: new Date()
      });

      // Remove from memory - keyed by userId
      this.userSessionsByUser.delete(userId);

      // Auth directory persists - do not delete to maintain auth state
      console.log(`� Preserving auth directory for ${userSession.userName}: ${userSession.authPath}`);

      console.log(`✅ Successfully cleaned up session for ${userSession.userName}`);
    } catch (error) {
      console.error(`❌ Error during session cleanup for ${userSession.userName}:`, error);
    }
  }

  /**
   * Cleanup inactive sessions with configurable timeout - excludes pairing/restarting sessions
   */
  private async cleanupInactiveSessions() {
    const now = new Date();
    const inactiveThreshold = parseInt(process.env.INACTIVE_SESSION_TIMEOUT || '300000'); // 5 minutes default
    let cleanedCount = 0;

    // Use Array.from to avoid iterator issues - iterate over userId-keyed sessions
    const sessions = Array.from(this.userSessionsByUser.entries());
    
    for (const [userId, session] of sessions) {
      const timeSinceLastActivity = now.getTime() - session.lastActivity.getTime();
      
      // Skip sessions that are pairing or restarting to prevent cleanup during authentication
      if (!session.isConnected && 
          session.status !== 'pairing' && 
          session.status !== 'restarting' && 
          timeSinceLastActivity > inactiveThreshold) {
        log(`🧹 Cleaning up inactive session for ${session.userName}: ${userId} (inactive for ${Math.round(timeSinceLastActivity/1000)}s)`);
        await this.cleanupUserSession(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log(`🧹 Cleanup completed: ${cleanedCount} sessions removed. Active sessions: ${this.userSessionsByUser.size}/${this.maxGlobalSessions}`);
    }
  }

  /**
   * Cleanup oldest session for a specific user to make room for new one
   */
  private async cleanupOldestUserSessionForUser(userId: string) {
    const userSession = this.userSessionsByUser.get(userId);
    if (userSession) {
      log(`🧹 Removing existing session for ${userSession.userName}: ${userId}`);
      await this.cleanupUserSession(userId);
    }
  }

  /**
   * Force cleanup all disconnected sessions (emergency cleanup)
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
   * Get all active user sessions
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
    return Array.from(this.userSessionsByUser.values()).map(session => ({
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
   * Get sessions for specific user
   */
  getUserSessions(userId: string): Array<{
    sessionId: string;
    isConnected: boolean;
    phoneNumber?: string;
    lastActivity: Date;
  }> {
    const userSession = this.userSessionsByUser.get(userId);
    if (!userSession) return [];
    
    return [{
      sessionId: userSession.sessionId,
      isConnected: userSession.isConnected,
      phoneNumber: userSession.phoneNumber,
      lastActivity: userSession.lastActivity
    }];
  }

  /**
   * Get specific user session status
   */
  getUserSessionStatus(userId: string): {
    isConnected: boolean;
    phoneNumber?: string;
    lastActivity?: Date;
    userName?: string;
    clinicName?: string;
  } | null {
    const session = this.userSessionsByUser.get(userId);
    if (!session) return null;

    return {
      isConnected: session.isConnected,
      phoneNumber: session.phoneNumber,
      lastActivity: session.lastActivity,
      userName: session.userName,
      clinicName: session.clinicName
    };
  }

  /**
   * Initialize service and restore previous sessions
   */
  async initialize() {
    console.log('🚀 Initializing Multi-User WhatsApp Service...');
    
    try {
      // Get all active sessions from database
      const activeSessions = await storage.getAllActiveWhatsAppSessions();
      
      console.log(`📱 Found ${activeSessions.length} previous active sessions`);
      
      // Restore sessions for users who were previously connected
      for (const session of activeSessions.slice(0, 5)) { // Limit to 5 on startup
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
    const userStats = new Map<string, { userName: string; sessionCount: number; connectedCount: number }>();

    sessions.forEach(session => {
      const existing = userStats.get(session.userId) || {
        userName: session.userName,
        sessionCount: 0,
        connectedCount: 0
      };
      
      existing.sessionCount = 1; // Only 1 session per user now
      if (session.isConnected) existing.connectedCount = 1;
      
      userStats.set(session.userId, existing);
    });

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.isConnected || s.isAuthenticated).length,
      connectedSessions: sessions.filter(s => s.isConnected).length,
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
      // Find existing session for this user
      const userSession = this.userSessionsByUser.get(userId);

      if (!userSession || userSession.isAuthenticated) {
        return {
          success: false,
          error: 'No pending authentication session found for this user. Please create a new session.'
        };
      }

      // If there's already a QR code, return it
      if (userSession.qrCode) {
        console.log(`📱 Returning existing QR code for ${userSession.userName}`);
        return {
          success: true,
          qrCode: userSession.qrCode
        };
      }

      // If no QR code available, the session might need to be recreated
      return {
        success: false,
        error: 'No QR code available. Session may need to be recreated.'
      };

    } catch (error: any) {
      console.error(`❌ Failed to refresh QR for user ${userId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get active session info for a user
   */
  async getUserSessionInfo(userId: string): Promise<{ 
    success: boolean; 
    sessionInfo?: any; 
    error?: string 
  }> {
    try {
      const userSession = this.userSessionsByUser.get(userId);

      if (!userSession) {
        return {
          success: false,
          error: 'No sessions found for this user'
        };
      }

      const sessionInfo = [{
        sessionId: userSession.sessionId,
        isConnected: userSession.isConnected,
        isAuthenticated: userSession.isAuthenticated,
        phoneNumber: userSession.phoneNumber,
        lastActivity: userSession.lastActivity,
        reconnectAttempts: userSession.reconnectAttempts,
        hasQrCode: !!userSession.qrCode,
        status: userSession.status
      }];

      return {
        success: true,
        sessionInfo
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
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
      activeSessions: sessions.filter(s => s.isConnected).length,
      connectedSessions: sessions.filter(s => s.isAuthenticated).length,
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
          sessionCount: 1, // Always 1 per user now
          connectedCount: 0
        });
      }
      
      const stats = userStats.get(session.userId)!;
      if (session.isAuthenticated) {
        stats.connectedCount = 1; // Always 1 or 0 per user now
      }
    }
    
    return Array.from(userStats.values());
  }
}

// Export singleton instance
export const multiUserWhatsAppService = new MultiUserWhatsAppService();