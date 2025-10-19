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
  sessionDir: string;
  reconnectAttempts: number;
  maxSessions: number;
  sessionId: string;
}

interface SessionStrategy {
  name: 'business_hours' | 'always_on' | 'on_demand';
  duration: number; // milliseconds
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  businessHoursOnly?: boolean;
}

export class MultiUserWhatsAppService extends EventEmitter {
  private userSessions: Map<string, UserSession> = new Map();
  private readonly sessionsDir = './server/sessions/multi_user';
  private readonly maxReconnectAttempts = 3;
  private readonly maxGlobalSessions = 15;

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
    this.ensureSessionsDirectory();
    
    // Clean up inactive sessions with configurable interval
    const cleanupInterval = parseInt(process.env.SESSION_CLEANUP_INTERVAL || '300000'); // 5 minutes default
    setInterval(() => this.cleanupInactiveSessions(), cleanupInterval);
    
    log(`🚀 Multi-User WhatsApp Service initialized with limits:`);
    log(`   - Max Global Sessions: ${this.maxGlobalSessions}`);
    log(`   - Max Sessions Per User: ${process.env.WHATSAPP_MAX_SESSIONS_PER_USER || 3}`);
    log(`   - Cleanup Interval: ${cleanupInterval/1000}s`);
    log(`   - Inactive Timeout: ${process.env.INACTIVE_SESSION_TIMEOUT || 300000}ms`);
  }

  private ensureSessionsDirectory() {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
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
    strategyName: keyof typeof this.SESSION_STRATEGIES = 'on_demand'
  ): Promise<{ success: boolean; sessionId?: string; qrCode?: string; error?: string }> {
    try {
      // Cleanup inactive sessions first to free up space
      await this.cleanupInactiveSessions();

      // Check global session limit after cleanup
      const activeSessions = Array.from(this.userSessions.values()).filter(s => s.isConnected);
      if (activeSessions.length >= this.maxGlobalSessions) {
        // Try to cleanup disconnected sessions aggressively
        await this.cleanupInactiveSessions();
        
        // Recheck after aggressive cleanup
        const stillActiveSessions = Array.from(this.userSessions.values()).filter(s => s.isConnected);
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
      const userActiveSessions = Array.from(this.userSessions.values())
        .filter(session => session.userId === userId && session.isConnected);
      
      const maxUserSessions = parseInt(process.env.WHATSAPP_MAX_SESSIONS_PER_USER || '3');
      if (userActiveSessions.length >= maxUserSessions) {
        // Cleanup oldest user session to make room
        await this.cleanupOldestUserSessionForUser(userId);
        log(`🧹 Cleaned up oldest session for user ${user.name} to make room for new connection`);
      }

      // Create session directory for this user
      const sessionId = this.generateSessionId(userId);
      const sessionDir = path.join(this.sessionsDir, sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });

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
        sessionDir,
        reconnectAttempts: 0,
        maxSessions: user.max_sessions || 2,
        sessionId
      };

      // Create Baileys auth state for this user
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

      // Get latest Baileys version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`📱 Using WA v${version.join('.')}, isLatest: ${isLatest} for ${user.name}`);

      // Create WhatsApp socket for this specific user
      const socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: [`${user.clinic_name || 'LIMS'}-${user.name}`, 'Chrome', '1.0.0'],
        generateHighQualityLinkPreview: true,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 20000,
        keepAliveIntervalMs: 30000,
      });

      userSession.socket = socket;
      this.userSessions.set(sessionId, userSession);

      // Save session to database
      await storage.createWhatsAppSession({
        id: sessionId,
        userId,
        sessionId,
        isActive: true,
        strategy: strategyName,
        sessionData: { sessionDir, strategy: strategyName },
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Handle connection updates for this specific user
      socket.ev.on('connection.update', async (update: any) => {
        await this.handleUserConnectionUpdate(sessionId, update);
      });

      // Handle credentials update
      socket.ev.on('creds.update', saveCreds);

      // Handle messages for this user
      socket.ev.on('messages.upsert', async (m) => {
        await this.handleUserMessages(sessionId, m);
      });

      console.log(`🔌 Created WhatsApp session for user: ${user.name} (${user.clinic_name}) - Session: ${sessionId}`);
      
      // Wait for QR code or authentication
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({
            success: false,
            error: 'QR code generation timeout'
          });
        }, 30000);

        socket.ev.on('connection.update', (update) => {
          if (update.qr) {
            clearTimeout(timeout);
            userSession.qrCode = update.qr;
            
            // Create QR code URL
            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(update.qr)}`;
            
            resolve({
              success: true,
              sessionId,
              qrCode: qrCodeUrl
            });
          }
          
          if (update.connection === 'open') {
            clearTimeout(timeout);
            resolve({
              success: true,
              sessionId,
              qrCode: undefined
            });
          }

          if (update.connection === 'close') {
            clearTimeout(timeout);
            resolve({
              success: false,
              error: 'Connection closed during initialization'
            });
          }
        });
      });

    } catch (error: any) {
      console.error(`❌ Failed to create session for user ${userId}:`, error);
      
      await storage.createSystemLog({
        level: 'error',
        message: `Failed to create WhatsApp session for user ${userId}`,
        service: 'whatsapp',
        userId,
        metadata: { error: error.message }
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle connection updates for specific user
   */
  private async handleUserConnectionUpdate(sessionId: string, update: any) {
    const userSession = this.userSessions.get(sessionId);
    if (!userSession) return;

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`📱 QR Code generated for ${userSession.userName} (${userSession.clinicName})`);
      
      // Generate QR code URL
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qr)}`;
      userSession.qrCode = qrCodeUrl;

      // Update database
      await storage.updateUserWhatsAppSession(userSession.userId, {
        qrCodeData: qrCodeUrl,
        updatedAt: new Date()
      });

      // Emit to specific user clients
      this.emit('user-qr-code', {
        sessionId,
        userId: userSession.userId,
        userName: userSession.userName,
        clinicName: userSession.clinicName,
        qrCode: qrCodeUrl,
        rawQR: qr
      });
    }

    if (connection === 'open') {
      userSession.isConnected = true;
      userSession.isAuthenticated = true;
      userSession.phoneNumber = userSession.socket?.user?.id?.split(':')[0];
      userSession.lastActivity = new Date();
      userSession.reconnectAttempts = 0;

      console.log(`✅ ${userSession.userName} (${userSession.clinicName}) connected via WhatsApp: ${userSession.phoneNumber}`);

      // Update database
      await storage.updateUserWhatsAppSession(userSession.userId, {
        isAuthenticated: true,
        isActive: true,
        phoneNumber: userSession.phoneNumber,
        lastActivity: new Date(),
        updatedAt: new Date()
      });

      // Emit user-specific connection status
      this.emit('user-connected', {
        sessionId,
        userId: userSession.userId,
        userName: userSession.userName,
        clinicName: userSession.clinicName,
        phoneNumber: userSession.phoneNumber,
        isConnected: true
      });

      // Log successful connection
      await storage.createSystemLog({
        level: 'info',
        message: `WhatsApp connected for ${userSession.userName} (${userSession.clinicName})`,
        service: 'whatsapp',
        userId: userSession.userId,
        metadata: { 
          phoneNumber: userSession.phoneNumber,
          sessionDir: userSession.sessionDir,
          sessionId
        }
      });
    }

    if (connection === 'close') {
      userSession.isConnected = false;
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log(`🔌 ${userSession.userName} (${userSession.clinicName}) disconnected. Should reconnect: ${shouldReconnect}`);

      if (shouldReconnect && userSession.reconnectAttempts < this.maxReconnectAttempts) {
        userSession.reconnectAttempts++;
        console.log(`🔄 Attempting to reconnect ${userSession.userName} (${userSession.clinicName}) - Attempt ${userSession.reconnectAttempts}`);
        
        setTimeout(() => {
          this.reconnectUser(userSession.userId);
        }, 5000);
      } else {
        console.log(`❌ Max reconnection attempts reached for ${userSession.userName} (${userSession.clinicName})`);
        await this.cleanupUserSession(sessionId);
      }

      // Update database
      await storage.updateUserWhatsAppSession(userSession.userId, {
        isAuthenticated: false,
        isActive: shouldReconnect,
        updatedAt: new Date()
      });

      // Emit disconnection
      this.emit('user-disconnected', {
        sessionId,
        userId: userSession.userId,
        userName: userSession.userName,
        clinicName: userSession.clinicName,
        shouldReconnect
      });
    }
  }

  /**
   * Handle messages for specific user
   */
  private async handleUserMessages(sessionId: string, messageUpdate: any) {
    const userSession = this.userSessions.get(sessionId);
    if (!userSession) return;

    // Log received messages for this user
    await storage.createSystemLog({
      level: 'info',
      message: `Message received for ${userSession.userName}`,
      service: 'whatsapp',
      userId: userSession.userId,
      metadata: { 
        messageCount: messageUpdate.messages.length,
        sessionId
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
      // Find active session for this user
      const userSession = Array.from(this.userSessions.values())
        .find(session => session.userId === userId && session.isConnected);

      if (!userSession || !userSession.socket) {
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
      // Find active session for this user
      const userSession = Array.from(this.userSessions.values())
        .find(session => session.userId === userId && session.isConnected);

      if (!userSession || !userSession.socket) {
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
  async disconnectUserSession(sessionId: string): Promise<boolean> {
    try {
      const userSession = this.userSessions.get(sessionId);
      if (!userSession) {
        console.log(`⚠️ No session found for session ${sessionId}`);
        return false;
      }

      if (userSession.socket) {
        await userSession.socket.logout();
      }

      await this.cleanupUserSession(sessionId);
      console.log(`🔌 Disconnected session: ${sessionId} for ${userSession.userName} (${userSession.clinicName})`);
      return true;

    } catch (error: any) {
      console.error(`❌ Failed to disconnect session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Disconnect all sessions for a user
   */
  async disconnectUser(userId: string): Promise<number> {
    try {
      const userSessions = Array.from(this.userSessions.values())
        .filter(session => session.userId === userId);

      let disconnectedCount = 0;
      for (const session of userSessions) {
        if (await this.disconnectUserSession(session.sessionId)) {
          disconnectedCount++;
        }
      }

      console.log(`🔌 Disconnected ${disconnectedCount} sessions for user ${userId}`);
      return disconnectedCount;

    } catch (error: any) {
      console.error(`❌ Failed to disconnect user ${userId}:`, error);
      return 0;
    }
  }

  /**
   * Cleanup user session
   */
  private async cleanupUserSession(sessionId: string) {
    const userSession = this.userSessions.get(sessionId);
    if (!userSession) return;

    // Update database
    await storage.updateUserWhatsAppSession(userSession.userId, {
      isAuthenticated: false,
      isActive: false,
      updatedAt: new Date()
    });

    // Remove from memory
    this.userSessions.delete(sessionId);

    // Clean up session directory after delay (optional)
    setTimeout(() => {
      try {
        if (fs.existsSync(userSession.sessionDir)) {
          fs.rmSync(userSession.sessionDir, { recursive: true, force: true });
        }
      } catch (error) {
        console.error(`Failed to cleanup session directory: ${userSession.sessionDir}`, error);
      }
    }, 60000); // 1 minute delay
  }

  /**
   * Cleanup inactive sessions with configurable timeout
   */
  private async cleanupInactiveSessions() {
    const now = new Date();
    const inactiveThreshold = parseInt(process.env.INACTIVE_SESSION_TIMEOUT || '300000'); // 5 minutes default
    let cleanedCount = 0;

    // Use Array.from to avoid iterator issues
    const sessions = Array.from(this.userSessions.entries());
    
    for (const [sessionId, session] of sessions) {
      const timeSinceLastActivity = now.getTime() - session.lastActivity.getTime();
      
      if (!session.isConnected && timeSinceLastActivity > inactiveThreshold) {
        log(`🧹 Cleaning up inactive session for ${session.userName}: ${sessionId} (inactive for ${Math.round(timeSinceLastActivity/1000)}s)`);
        await this.cleanupUserSession(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log(`🧹 Cleanup completed: ${cleanedCount} sessions removed. Active sessions: ${this.userSessions.size}/${this.maxGlobalSessions}`);
    }
  }

  /**
   * Cleanup oldest session for a specific user to make room for new one
   */
  private async cleanupOldestUserSessionForUser(userId: string) {
    const userSessions = Array.from(this.userSessions.entries())
      .filter(([_, session]) => session.userId === userId)
      .sort(([_, a], [__, b]) => a.lastActivity.getTime() - b.lastActivity.getTime());

    if (userSessions.length > 0) {
      const [oldestSessionId, oldestSession] = userSessions[0];
      log(`🧹 Removing oldest session for ${oldestSession.userName}: ${oldestSessionId}`);
      await this.cleanupUserSession(oldestSessionId);
    }
  }

  /**
   * Force cleanup all disconnected sessions (emergency cleanup)
   */
  private async forceCleanupDisconnectedSessions() {
    const sessions = Array.from(this.userSessions.entries());
    let cleanedCount = 0;

    for (const [sessionId, session] of sessions) {
      if (!session.isConnected && !session.isAuthenticated) {
        log(`🧹 Force cleaning disconnected session: ${sessionId} (${session.userName})`);
        await this.cleanupUserSession(sessionId);
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
    return Array.from(this.userSessions.values()).map(session => ({
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
    return Array.from(this.userSessions.values())
      .filter(session => session.userId === userId)
      .map(session => ({
        sessionId: session.sessionId,
        isConnected: session.isConnected,
        phoneNumber: session.phoneNumber,
        lastActivity: session.lastActivity
      }));
  }

  /**
   * Get specific user session status
   */
  getUserSessionStatus(sessionId: string): {
    isConnected: boolean;
    phoneNumber?: string;
    lastActivity?: Date;
    userName?: string;
    clinicName?: string;
  } | null {
    const session = this.userSessions.get(sessionId);
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
    const sessions = Array.from(this.userSessions.values());
    const userStats = new Map<string, { userName: string; sessionCount: number; connectedCount: number }>();

    sessions.forEach(session => {
      const existing = userStats.get(session.userId) || {
        userName: session.userName,
        sessionCount: 0,
        connectedCount: 0
      };
      
      existing.sessionCount++;
      if (session.isConnected) existing.connectedCount++;
      
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
    const sessions = Array.from(this.userSessions.entries());
    let cleanedCount = 0;

    for (const [sessionId, session] of sessions) {
      if (!session.isAuthenticated) {
        log(`🧹 Force cleaning session: ${sessionId} (${session.userName})`);
        await this.cleanupUserSession(sessionId);
        cleanedCount++;
      }
    }

    log(`🧹 Force cleanup completed: ${cleanedCount} sessions removed`);
    return cleanedCount;
  }

  /**
   * Get system summary for admin monitoring
   */
  async getSystemSummary() {
    const sessions = Array.from(this.userSessions.values());
    
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
    
    for (const session of this.userSessions.values()) {
      if (!userStats.has(session.userId)) {
        userStats.set(session.userId, {
          userId: session.userId,
          userName: session.userName,
          sessionCount: 0,
          connectedCount: 0
        });
      }
      
      const stats = userStats.get(session.userId)!;
      stats.sessionCount++;
      if (session.isAuthenticated) {
        stats.connectedCount++;
      }
    }
    
    return Array.from(userStats.values());
  }
}

// Export singleton instance
export const multiUserWhatsAppService = new MultiUserWhatsAppService();