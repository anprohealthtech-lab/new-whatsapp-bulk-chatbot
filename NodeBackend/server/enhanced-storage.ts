import { DatabaseStorage } from './storage/DatabaseStorage.js';

interface UserData {
  id: string;
  username: string;
  email?: string;
  passwordHash: string;
  organizationId?: string;
  role?: 'admin' | 'manager' | 'user';
  isActive?: boolean;
}

interface MessageData {
  id: string;
  userId: string;
  sessionId?: string;
  phoneNumber: string;
  content: string;
  type: string;
  status: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  sampleId?: string;
  patientName?: string;
  doctorName?: string;
  labName?: string;
  reportDate?: string;
  priority?: string;
  metadata?: string;
  createdAt?: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
}

interface OrganizationData {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  subscriptionPlan?: string;
  maxUsers?: number;
  maxSessions?: number;
  maxMessagesPerDay?: number;
  isActive?: boolean;
}

interface WhatsAppSessionData {
  id: string;
  userId: string;
  phoneNumber?: string;
  sessionData?: string;
  isActive?: boolean;
  isAuthenticated?: boolean;
  qrCode?: string;
  connectionAttempts?: number;
  lastActivity?: Date;
  expiresAt?: Date;
  sessionStrategy?: string;
}

interface SystemLogData {
  id: string;
  level: string;
  message: string;
  userId?: string;
  sessionId?: string;
  component?: string;
  metadata?: string;
  createdAt?: Date;
}

interface MessageFilter {
  limit?: number;
  offset?: number;
  status?: string;
  type?: string;
  sessionId?: string;
}

// Enhanced storage interface for multi-user system
class MultiUserStorage extends DatabaseStorage {
  // ========================================
  // User Management
  // ========================================

  async createUser(userData: UserData) {
    const { users } = await import('../shared/schema.js');
    const [user] = await this.db
      .insert(users)
      .values({
        id: userData.id,
        username: userData.username,
        email: userData.email,
        passwordHash: userData.passwordHash,
        organizationId: userData.organizationId,
        role: userData.role || 'user',
        isActive: userData.isActive ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return user;
  }

  async getUserByUsername(username: string) {
    const { users } = await import('../shared/schema.js');
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return user;
  }

  async getUserById(id: string) {
    const { users } = await import('../shared/schema.js');
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id));
    return user;
  }

  async updateUserLastLogin(userId: string) {
    const { users } = await import('../shared/schema.js');
    const [user] = await this.db
      .update(users)
      .set({ 
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getAllUsers() {
    const { users } = await import('../shared/schema.js');
    return await this.db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        organizationId: users.organizationId,
        role: users.role,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
  }

  // ========================================
  // Organization Management
  // ========================================

  async createOrganization(orgData: OrganizationData) {
    const { organizations } = await import('../shared/schema.js');
    const [org] = await this.db
      .insert(organizations)
      .values({
        id: orgData.id,
        name: orgData.name,
        email: orgData.email,
        phone: orgData.phone,
        address: orgData.address,
        subscriptionPlan: orgData.subscriptionPlan || 'basic',
        maxUsers: orgData.maxUsers || 1,
        maxSessions: orgData.maxSessions || 1,
        maxMessagesPerDay: orgData.maxMessagesPerDay || 100,
        isActive: orgData.isActive ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return org;
  }

  async getOrganizationById(id: string) {
    const { organizations } = await import('../shared/schema.js');
    const [org] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id));
    return org;
  }

  // ========================================
  // WhatsApp Session Management
  // ========================================

  async createWhatsAppSession(sessionData: WhatsAppSessionData) {
    const { whatsappSessions } = await import('../shared/schema.js');
    const [session] = await this.db
      .insert(whatsappSessions)
      .values({
        id: sessionData.id,
        userId: sessionData.userId,
        phoneNumber: sessionData.phoneNumber,
        sessionData: sessionData.sessionData,
        isActive: sessionData.isActive ?? false,
        isAuthenticated: sessionData.isAuthenticated ?? false,
        qrCode: sessionData.qrCode,
        connectionAttempts: sessionData.connectionAttempts ?? 0,
        lastActivity: sessionData.lastActivity,
        expiresAt: sessionData.expiresAt,
        sessionStrategy: sessionData.sessionStrategy || 'business_hours',
        createdAt: new Date(),
      })
      .returning();
    return session;
  }

  async updateWhatsAppSession(sessionId: string, updates: Partial<WhatsAppSessionData>) {
    const { whatsappSessions } = await import('../shared/schema.js');
    const [session] = await this.db
      .update(whatsappSessions)
      .set(updates)
      .where(eq(whatsappSessions.id, sessionId))
      .returning();
    return session;
  }

  async getUserSessions(userId: string) {
    const { whatsappSessions } = await import('../shared/schema.js');
    return await this.db
      .select()
      .from(whatsappSessions)
      .where(eq(whatsappSessions.userId, userId))
      .orderBy(desc(whatsappSessions.createdAt));
  }

  async deleteWhatsAppSession(sessionId: string) {
    const { whatsappSessions } = await import('../shared/schema.js');
    await this.db
      .delete(whatsappSessions)
      .where(eq(whatsappSessions.id, sessionId));
  }

  // ========================================
  // Enhanced Message Management
  // ========================================

  async createMessage(messageData: MessageData) {
    const { messages } = await import('../shared/schema.js');
    const [message] = await this.db
      .insert(messages)
      .values({
        id: messageData.id,
        userId: messageData.userId,
        sessionId: messageData.sessionId,
        phoneNumber: messageData.phoneNumber,
        content: messageData.content,
        type: messageData.type,
        status: messageData.status,
        fileUrl: messageData.fileUrl,
        fileName: messageData.fileName,
        fileSize: messageData.fileSize,
        sampleId: messageData.sampleId,
        patientName: messageData.patientName,
        doctorName: messageData.doctorName,
        labName: messageData.labName,
        reportDate: messageData.reportDate,
        priority: messageData.priority || 'normal',
        metadata: messageData.metadata,
        createdAt: messageData.createdAt || new Date(),
        sentAt: messageData.sentAt,
        deliveredAt: messageData.deliveredAt,
        failedAt: messageData.failedAt,
        retryCount: 0,
      })
      .returning();
    return message;
  }

  async getUserMessages(userId: string, filters: MessageFilter = {}) {
    const { messages } = await import('../shared/schema.js');
    let query = this.db
      .select()
      .from(messages)
      .where(eq(messages.userId, userId));

    if (filters.status) {
      query = query.where(eq(messages.status, filters.status));
    }
    if (filters.type) {
      query = query.where(eq(messages.type, filters.type));
    }
    if (filters.sessionId) {
      query = query.where(eq(messages.sessionId, filters.sessionId));
    }

    query = query.orderBy(desc(messages.createdAt));

    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    if (filters.offset) {
      query = query.offset(filters.offset);
    }

    return await query;
  }

  async getUserMessageCount(userId: string) {
    const { messages } = await import('../shared/schema.js');
    const [result] = await this.db
      .select({ count: count() })
      .from(messages)
      .where(eq(messages.userId, userId));
    return result.count;
  }

  // ========================================
  // Enhanced System Logs
  // ========================================

  async createSystemLog(logData: SystemLogData) {
    const { systemLogs } = await import('../shared/schema.js');
    const [log] = await this.db
      .insert(systemLogs)
      .values({
        id: logData.id,
        level: logData.level,
        message: logData.message,
        userId: logData.userId,
        sessionId: logData.sessionId,
        component: logData.component,
        metadata: logData.metadata,
        createdAt: logData.createdAt || new Date(),
      })
      .returning();
    return log;
  }

  async getSystemLogs(filters: { level?: string; component?: string; userId?: string; limit?: number } = {}) {
    const { systemLogs } = await import('../shared/schema.js');
    let query = this.db.select().from(systemLogs);

    if (filters.level) {
      query = query.where(eq(systemLogs.level, filters.level));
    }
    if (filters.component) {
      query = query.where(eq(systemLogs.component, filters.component));
    }
    if (filters.userId) {
      query = query.where(eq(systemLogs.userId, filters.userId));
    }

    query = query.orderBy(desc(systemLogs.createdAt));

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    return await query;
  }

  // ========================================
  // Usage Statistics
  // ========================================

  async recordUsageStats(userId: string, organizationId: string, statsData: any) {
    const { usageStats } = await import('../shared/schema.js');
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Try to update existing record, otherwise insert new one
    const existing = await this.db
      .select()
      .from(usageStats)
      .where(and(
        eq(usageStats.userId, userId),
        eq(usageStats.date, date)
      ));

    if (existing.length > 0) {
      const [updated] = await this.db
        .update(usageStats)
        .set({
          messagesCount: existing[0].messagesCount + (statsData.messagesCount || 0),
          mediaFilesCount: existing[0].mediaFilesCount + (statsData.mediaFilesCount || 0),
          sessionsCount: Math.max(existing[0].sessionsCount, statsData.sessionsCount || 0),
          totalFileSize: existing[0].totalFileSize + (statsData.totalFileSize || 0),
        })
        .where(and(
          eq(usageStats.userId, userId),
          eq(usageStats.date, date)
        ))
        .returning();
      return updated;
    } else {
      const [newStats] = await this.db
        .insert(usageStats)
        .values({
          id: `stats_${userId}_${date}`,
          userId,
          organizationId,
          date,
          messagesCount: statsData.messagesCount || 0,
          mediaFilesCount: statsData.mediaFilesCount || 0,
          sessionsCount: statsData.sessionsCount || 0,
          totalFileSize: statsData.totalFileSize || 0,
          createdAt: new Date(),
        })
        .returning();
      return newStats;
    }
  }
}

// Import necessary operators
const { eq, desc, count, and } = await import('drizzle-orm');

// Export enhanced storage instance
export const storage = new MultiUserStorage();