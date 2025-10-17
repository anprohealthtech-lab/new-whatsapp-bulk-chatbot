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
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface SessionInfo {
  id: string;
  socket: WASocket | null;
  userId: string;
  phoneNumber?: string;
  isAuthenticated: boolean;
  isActive: boolean;
  qrCode?: string;
  lastActivity: Date;
  connectionAttempts: number;
  sessionStrategy: SessionStrategy;
  reconnectTimeout?: NodeJS.Timeout;
  cleanupTimeout?: NodeJS.Timeout;
  authState?: AuthenticationState;
}

interface SessionStrategy {
  name: 'business_hours' | 'always_on' | 'on_demand';
  duration: number; // milliseconds
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  businessHoursOnly?: boolean;
}

interface RateLimitInfo {
  messagesPerMinute: number;
  messagesPerHour: number;
  messagesPerDay: number;
  mediaFilesPerHour: number;
  lastMessageTime: Date;
  messageCountMinute: number;
  messageCountHour: number;
  messageCountDay: number;
  mediaCountHour: number;
}

export class MultiWhatsAppService extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();
  private rateLimits: Map<string, RateLimitInfo> = new Map();
  private readonly authBasePath: string;
  private readonly MAX_CONCURRENT_SESSIONS = 15;
  
  // Session strategies
  private readonly SESSION_STRATEGIES: Record<string, SessionStrategy> = {
    business_hours: {
      name: 'business_hours',
      duration: 12 * 60 * 60 * 1000, // 12 hours
      autoReconnect: true,
      maxReconnectAttempts: 3,
      businessHoursOnly: true
    },
    always_on: {
      name: 'always_on',
      duration: 24 * 60 * 60 * 1000, // 24 hours
      autoReconnect: true,
      maxReconnectAttempts: 5,
      businessHoursOnly: false
    },
    on_demand: {
      name: 'on_demand',
      duration: 4 * 60 * 60 * 1000, // 4 hours
      autoReconnect: false,
      maxReconnectAttempts: 1,
      businessHoursOnly: false
    }
  };

  // Rate limits per subscription tier
  private readonly RATE_LIMITS = {
    basic: {
      messagesPerMinute: 5,
      messagesPerHour: 100,
      messagesPerDay: 500,
      mediaFilesPerHour: 20
    },
    professional: {
      messagesPerMinute: 20,
      messagesPerHour: 1000,
      messagesPerDay: 5000,
      mediaFilesPerHour: 100
    },
    enterprise: {
      messagesPerMinute: 50,
      messagesPerHour: 5000,
      messagesPerDay: 25000,
      mediaFilesPerHour: 500
    }
  };

  constructor() {
    super();
    this.authBasePath = path.join(process.cwd(), 'server/sessions/multi_baileys_auth');
    if (!fs.existsSync(this.authBasePath)) {
      fs.mkdirSync(this.authBasePath, { recursive: true });
    }

    // Clean up inactive sessions every 30 minutes
    setInterval(() => this.cleanupInactiveSessions(), 30 * 60 * 1000);
    
    // Reset rate limits every hour
    setInterval(() => this.resetHourlyRateLimits(), 60 * 60 * 1000);
    
    // Reset daily rate limits at midnight
    setInterval(() => this.resetDailyRateLimits(), 24 * 60 * 60 * 1000);

    console.log('🚀 Multi-Session WhatsApp Service initialized');
  }

  /**
   * Create a new WhatsApp session for a user
   */
  async createUserSession(
    userId: string, 
    strategyName: keyof typeof this.SESSION_STRATEGIES = 'business_hours'
  ): Promise<{ sessionId: string; qrCode?: string }> {
    
    // Check concurrent session limit
    if (this.sessions.size >= this.MAX_CONCURRENT_SESSIONS) {
      throw new Error('Maximum concurrent sessions reached. Please try again later.');
    }

    // Check if user already has active sessions
    const userActiveSessions = this.getUserActiveSessions(userId);
    if (userActiveSessions.length > 0) {
      const existingSession = userActiveSessions[0];
      if (existingSession.qrCode) {
        return { sessionId: existingSession.id, qrCode: existingSession.qrCode };
      }
    }

    const sessionId = this.generateSessionId(userId);
    const strategy = this.SESSION_STRATEGIES[strategyName];
    
    const sessionInfo: SessionInfo = {
      id: sessionId,
      socket: null,
      userId,
      isAuthenticated: false,
      isActive: false,
      lastActivity: new Date(),
      connectionAttempts: 0,
      sessionStrategy: strategy
    };

    this.sessions.set(sessionId, sessionInfo);
    this.initializeRateLimit(userId);

    try {
      const { socket, qrCode } = await this.initializeSocket(sessionId);
      sessionInfo.socket = socket;
      sessionInfo.qrCode = qrCode;

      // Schedule session cleanup
      this.scheduleSessionCleanup(sessionId);

      this.emit('session-created', { sessionId, userId, qrCode });
      
      return { sessionId, qrCode };
    } catch (error: any) {
      this.sessions.delete(sessionId);
      throw new Error(`Failed to create session: ${error.message}`);
    }
  }

  /**
   * Initialize WhatsApp socket for a session
   */
  private async initializeSocket(sessionId: string): Promise<{ socket: WASocket; qrCode?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const authDir = path.join(this.authBasePath, sessionId);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    session.authState = state;

    const { version } = await fetchLatestBaileysVersion();
    
    const socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: [`LIMS-${session.userId}`, 'Chrome', '1.0.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000
    });

    let qrCode: string | undefined;

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`📱 QR Code generated for session ${sessionId}`);
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qr)}`;
        qrCode = qrUrl;
        session.qrCode = qrUrl;
        this.emit('qr-code', { sessionId, userId: session.userId, qr: qrUrl, rawQR: qr });
      }

      if (connection === 'open') {
        console.log(`✅ WhatsApp connected for session ${sessionId}`);
        session.isAuthenticated = true;
        session.isActive = true;
        session.lastActivity = new Date();
        session.qrCode = undefined;
        session.connectionAttempts = 0;
        
        this.emit('session-connected', { 
          sessionId, 
          userId: session.userId,
          phoneNumber: socket.user?.id?.split(':')[0] || 'unknown'
        });
        
        // Update phone number
        if (socket.user?.id) {
          session.phoneNumber = socket.user.id.split(':')[0];
        }
        
      } else if (connection === 'close') {
        console.log(`❌ WhatsApp connection closed for session ${sessionId}`);
        session.isAuthenticated = false;
        session.isActive = false;
        
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        const withinRetryLimit = session.connectionAttempts < session.sessionStrategy.maxReconnectAttempts;
        const shouldAutoReconnect = session.sessionStrategy.autoReconnect && withinRetryLimit;
        
        if (shouldReconnect && shouldAutoReconnect && this.isWithinOperatingHours(session.sessionStrategy)) {
          console.log(`🔄 Scheduling reconnection for session ${sessionId} in 30 seconds...`);
          session.connectionAttempts++;
          session.reconnectTimeout = setTimeout(() => {
            this.reconnectSession(sessionId);
          }, 30000);
        } else {
          console.log(`🚪 Session ${sessionId} disconnected permanently`);
          this.emit('session-disconnected', { sessionId, userId: session.userId, reason: 'connection_closed' });
          
          if ((lastDisconnect?.error as Boom)?.output?.statusCode === DisconnectReason.loggedOut) {
            this.cleanupSession(sessionId);
          }
        }
      }
    });

    return { socket, qrCode };
  }

  /**
   * Send text message via specific session
   */
  async sendMessage(sessionId: string, phoneNumber: string, message: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session?.socket || !session.isAuthenticated) {
      throw new Error('Session not authenticated or not found');
    }

    // Check rate limits
    await this.checkRateLimit(session.userId, 'message');

    const jid = `${this.formatPhoneNumber(phoneNumber)}@s.whatsapp.net`;
    
    try {
      const result = await session.socket.sendMessage(jid, { text: message });
      
      session.lastActivity = new Date();
      this.updateRateLimit(session.userId, 'message');
      
      this.emit('message-sent', {
        sessionId,
        userId: session.userId,
        messageId: result?.key?.id,
        to: phoneNumber,
        content: message,
        timestamp: Date.now()
      });
      
      return {
        id: result?.key?.id,
        to: phoneNumber,
        body: message,
        timestamp: Date.now(),
        sessionId
      };
    } catch (error: any) {
      console.error(`Failed to send message via session ${sessionId}:`, error);
      throw new Error(`Message sending failed: ${error.message}`);
    }
  }

  /**
   * Send media message via specific session
   */
  async sendMediaMessage(
    sessionId: string, 
    phoneNumber: string, 
    filePath: string, 
    caption?: string
  ): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session?.socket || !session.isAuthenticated) {
      throw new Error('Session not authenticated or not found');
    }

    // Check rate limits for media
    await this.checkRateLimit(session.userId, 'media');

    const jid = `${this.formatPhoneNumber(phoneNumber)}@s.whatsapp.net`;
    const fileBuffer = fs.readFileSync(filePath);
    const fileExtension = path.extname(filePath).toLowerCase();
    
    let messageContent: any = {};
    
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(fileExtension)) {
      messageContent = { image: fileBuffer, caption: caption };
    } else if (['.pdf', '.doc', '.docx', '.txt'].includes(fileExtension)) {
      messageContent = { 
        document: fileBuffer, 
        fileName: path.basename(filePath), 
        caption: caption 
      };
    } else {
      messageContent = { 
        document: fileBuffer, 
        fileName: path.basename(filePath), 
        caption: caption 
      };
    }
    
    try {
      const result = await session.socket.sendMessage(jid, messageContent);
      
      session.lastActivity = new Date();
      this.updateRateLimit(session.userId, 'media');
      
      this.emit('message-sent', {
        sessionId,
        userId: session.userId,
        messageId: result?.key?.id,
        to: phoneNumber,
        hasMedia: true,
        caption: caption,
        timestamp: Date.now()
      });
      
      return {
        id: result?.key?.id,
        to: phoneNumber,
        hasMedia: true,
        caption: caption,
        timestamp: Date.now(),
        sessionId
      };
    } catch (error: any) {
      console.error(`Failed to send media via session ${sessionId}:`, error);
      throw new Error(`Media sending failed: ${error.message}`);
    }
  }

  /**
   * Get user's active sessions
   */
  getUserActiveSessions(userId: string): SessionInfo[] {
    return Array.from(this.sessions.values())
      .filter(session => session.userId === userId && session.isActive);
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions overview
   */
  getAllSessions(): Array<{
    id: string;
    userId: string;
    phoneNumber?: string;
    isAuthenticated: boolean;
    isActive: boolean;
    lastActivity: Date;
    connectionAttempts: number;
    strategy: string;
  }> {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      userId: session.userId,
      phoneNumber: session.phoneNumber,
      isAuthenticated: session.isAuthenticated,
      isActive: session.isActive,
      lastActivity: session.lastActivity,
      connectionAttempts: session.connectionAttempts,
      strategy: session.sessionStrategy.name
    }));
  }

  /**
   * Disconnect specific session
   */
  async disconnectSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    console.log(`🔌 Disconnecting session ${sessionId}`);
    
    if (session.socket) {
      try {
        await session.socket.logout();
        session.socket.end(undefined);
      } catch (error) {
        console.error(`Error during session ${sessionId} logout:`, error);
      }
    }

    this.cleanupSession(sessionId);
    this.emit('session-disconnected', { sessionId, userId: session.userId, reason: 'manual_disconnect' });
  }

  /**
   * Reconnect specific session
   */
  private async reconnectSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    console.log(`🔄 Reconnecting session ${sessionId}`);
    
    try {
      if (session.socket) {
        session.socket.end(undefined);
      }

      const { socket, qrCode } = await this.initializeSocket(sessionId);
      session.socket = socket;
      if (qrCode) {
        session.qrCode = qrCode;
      }
    } catch (error: any) {
      console.error(`Failed to reconnect session ${sessionId}:`, error);
      session.connectionAttempts++;
      
      if (session.connectionAttempts >= session.sessionStrategy.maxReconnectAttempts) {
        console.log(`❌ Max reconnection attempts reached for session ${sessionId}`);
        this.cleanupSession(sessionId);
      }
    }
  }

  /**
   * Clean up specific session
   */
  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clear timeouts
    if (session.reconnectTimeout) {
      clearTimeout(session.reconnectTimeout);
    }
    if (session.cleanupTimeout) {
      clearTimeout(session.cleanupTimeout);
    }

    // Close socket connection
    if (session.socket) {
      try {
        session.socket.end(undefined);
      } catch (error) {
        console.error(`Error closing socket for session ${sessionId}:`, error);
      }
    }

    this.sessions.delete(sessionId);
    console.log(`🧹 Session ${sessionId} cleaned up`);
  }

  /**
   * Clean up inactive sessions
   */
  private cleanupInactiveSessions(): void {
    const now = new Date();
    const inactiveThreshold = 2 * 60 * 60 * 1000; // 2 hours

    for (const [sessionId, session] of this.sessions) {
      const inactiveTime = now.getTime() - session.lastActivity.getTime();
      
      if (!session.isActive && inactiveTime > inactiveThreshold) {
        console.log(`🧹 Cleaning up inactive session ${sessionId}`);
        this.cleanupSession(sessionId);
      }
    }
  }

  /**
   * Schedule session cleanup based on strategy
   */
  private scheduleSessionCleanup(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.cleanupTimeout = setTimeout(() => {
      console.log(`⏰ Session ${sessionId} expired due to strategy timeout`);
      this.disconnectSession(sessionId);
    }, session.sessionStrategy.duration);
  }

  /**
   * Check if current time is within operating hours for a strategy
   */
  private isWithinOperatingHours(strategy: SessionStrategy): boolean {
    if (!strategy.businessHoursOnly) return true;

    const hour = new Date().getHours();
    return hour >= 8 && hour <= 20; // 8 AM - 8 PM
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(userId: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `session_${userId}_${timestamp}_${random}`;
  }

  /**
   * Initialize rate limiting for user
   */
  private initializeRateLimit(userId: string): void {
    if (!this.rateLimits.has(userId)) {
      this.rateLimits.set(userId, {
        messagesPerMinute: 0,
        messagesPerHour: 0,
        messagesPerDay: 0,
        mediaFilesPerHour: 0,
        lastMessageTime: new Date(),
        messageCountMinute: 0,
        messageCountHour: 0,
        messageCountDay: 0,
        mediaCountHour: 0
      });
    }
  }

  /**
   * Check rate limits for user
   */
  private async checkRateLimit(userId: string, type: 'message' | 'media'): Promise<void> {
    const rateLimit = this.rateLimits.get(userId);
    if (!rateLimit) {
      this.initializeRateLimit(userId);
      return;
    }

    // For now, using 'professional' limits - in production, get from user's subscription
    const limits = this.RATE_LIMITS.professional;

    if (type === 'message') {
      if (rateLimit.messageCountMinute >= limits.messagesPerMinute) {
        throw new Error('Rate limit exceeded: Too many messages per minute');
      }
      if (rateLimit.messageCountHour >= limits.messagesPerHour) {
        throw new Error('Rate limit exceeded: Too many messages per hour');
      }
      if (rateLimit.messageCountDay >= limits.messagesPerDay) {
        throw new Error('Rate limit exceeded: Too many messages per day');
      }
    } else if (type === 'media') {
      if (rateLimit.mediaCountHour >= limits.mediaFilesPerHour) {
        throw new Error('Rate limit exceeded: Too many media files per hour');
      }
    }
  }

  /**
   * Update rate limit counters
   */
  private updateRateLimit(userId: string, type: 'message' | 'media'): void {
    const rateLimit = this.rateLimits.get(userId);
    if (!rateLimit) return;

    rateLimit.lastMessageTime = new Date();

    if (type === 'message') {
      rateLimit.messageCountMinute++;
      rateLimit.messageCountHour++;
      rateLimit.messageCountDay++;
    } else if (type === 'media') {
      rateLimit.mediaCountHour++;
    }
  }

  /**
   * Reset hourly rate limits
   */
  private resetHourlyRateLimits(): void {
    for (const rateLimit of this.rateLimits.values()) {
      rateLimit.messageCountHour = 0;
      rateLimit.mediaCountHour = 0;
    }
  }

  /**
   * Reset daily rate limits
   */
  private resetDailyRateLimits(): void {
    for (const rateLimit of this.rateLimits.values()) {
      rateLimit.messageCountDay = 0;
    }
  }

  /**
   * Format phone number for WhatsApp
   */
  private formatPhoneNumber(phoneNumber: string): string {
    let cleaned = phoneNumber.replace(/\D/g, '');
    if (!cleaned.startsWith('1') && cleaned.length === 10) {
      cleaned = '1' + cleaned;
    }
    return cleaned;
  }

  /**
   * Get system status and statistics
   */
  getSystemStatus(): {
    totalSessions: number;
    activeSessions: number;
    authenticatedSessions: number;
    sessionsPerUser: Record<string, number>;
    uptime: number;
  } {
    const sessions = Array.from(this.sessions.values());
    const sessionsPerUser: Record<string, number> = {};

    sessions.forEach(session => {
      sessionsPerUser[session.userId] = (sessionsPerUser[session.userId] || 0) + 1;
    });

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.isActive).length,
      authenticatedSessions: sessions.filter(s => s.isAuthenticated).length,
      sessionsPerUser,
      uptime: process.uptime()
    };
  }

  /**
   * Cleanup all sessions (for shutdown)
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up all WhatsApp sessions...');
    
    const cleanupPromises = Array.from(this.sessions.keys()).map(sessionId => 
      this.disconnectSession(sessionId).catch(error => 
        console.error(`Error cleaning up session ${sessionId}:`, error)
      )
    );
    
    await Promise.all(cleanupPromises);
    this.sessions.clear();
    this.rateLimits.clear();
    
    console.log('✅ All sessions cleaned up');
  }
}

// Create singleton instance
export const multiWhatsAppService = new MultiWhatsAppService();