import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, messages, systemLogs, organizations, whatsappSessions } from '@shared/schema';
import type { User, NewUser, Message, NewMessage, SystemLog, NewSystemLog, Organization, NewOrganization, WhatsappSession, NewWhatsappSession } from '@shared/schema';
import type { IStorage } from '../storage';

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(user: NewUser): Promise<User> {
    const result = await db.insert(users).values(user).returning();
    return result[0];
  }

  // Message methods
  async getMessage(id: string): Promise<Message | undefined> {
    const result = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
    return result[0];
  }

  async getMessages(filters?: { 
    status?: string; 
    phoneNumber?: string; 
    type?: string; 
    limit?: number; 
    offset?: number 
  }): Promise<Message[]> {
    let query = db.select().from(messages);

    const conditions = [];
    if (filters?.status) conditions.push(eq(messages.status, filters.status));
    if (filters?.phoneNumber) conditions.push(eq(messages.to, filters.phoneNumber));
    if (filters?.type) conditions.push(eq(messages.type, filters.type));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    query = query.orderBy(desc(messages.createdAt)) as any;

    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }
    if (filters?.offset) {
      query = query.offset(filters.offset) as any;
    }

    return await query;
  }

  async createMessage(message: NewMessage): Promise<Message> {
    const result = await db.insert(messages).values(message).returning();
    return result[0];
  }

  async updateMessage(id: string, updates: Partial<Message>): Promise<Message | undefined> {
    const result = await db.update(messages)
      .set(updates)
      .where(eq(messages.id, id))
      .returning();
    return result[0];
  }

  async getMessagesCount(filters?: { 
    status?: string; 
    phoneNumber?: string; 
    type?: string 
  }): Promise<number> {
    let query = db.select({ count: sql<number>`count(*)` }).from(messages);

    const conditions = [];
    if (filters?.status) conditions.push(eq(messages.status, filters.status));
    if (filters?.phoneNumber) conditions.push(eq(messages.to, filters.phoneNumber));
    if (filters?.type) conditions.push(eq(messages.type, filters.type));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const result = await query;
    return result[0]?.count || 0;
  }

  async getMessagesByDateRange(startDate: Date, endDate: Date): Promise<Message[]> {
    return await db.select().from(messages)
      .where(and(
        gte(messages.createdAt, startDate),
        lte(messages.createdAt, endDate)
      ) as any)
      .orderBy(desc(messages.createdAt)) as any;
  }

  // System log methods
  async getSystemLogs(limit: number = 50, offset: number = 0): Promise<SystemLog[]> {
    return await db.select().from(systemLogs)
      .orderBy(desc(systemLogs.timestamp))
      .limit(limit)
      .offset(offset);
  }

  async createSystemLog(log: NewSystemLog): Promise<SystemLog> {
    const result = await db.insert(systemLogs).values(log).returning();
    return result[0];
  }

  // External API methods
  async syncExternalUser(userData: Partial<NewUser> & { id: string, isExternal?: boolean }): Promise<User> {
    // Check if user exists
    const existingUser = await this.getUser(userData.id);
    
    if (existingUser) {
      // Update existing user
      const result = await db.update(users)
        .set({
          ...userData,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userData.id))
        .returning();
      return result[0];
    } else {
      // Create new user
      const newUser: NewUser = {
        id: userData.id,
        username: userData.username || 'external_user',
        email: userData.email,
        role: userData.role || 'user',
        organizationId: userData.organizationId,
        isActive: true,
      };
      return await this.createUser(newUser);
    }
  }

  async syncExternalOrganization(orgData: Partial<NewOrganization> & { id: string, isExternal?: boolean }): Promise<Organization> {
    // Check if organization exists
    const existing = await db.select().from(organizations).where(eq(organizations.id, orgData.id)).limit(1);
    
    if (existing.length > 0) {
      // Update existing organization
      const result = await db.update(organizations)
        .set({
          ...orgData,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, orgData.id))
        .returning();
      return result[0];
    } else {
      // Create new organization
      const newOrg: NewOrganization = {
        id: orgData.id,
        name: orgData.name || 'External Organization',
        subscriptionTier: 'basic',
        maxSessions: 5,
        maxUsersPerOrg: 10,
        isActive: true,
      };
      const result = await db.insert(organizations).values(newOrg).returning();
      return result[0];
    }
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUserLastLogin(userId: string): Promise<void> {
    await db.update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, userId));
  }

  async getMessageHistory(filters: {
    sessionId?: string;
    userId?: string;
    limit: number;
    offset: number;
  }): Promise<Message[]> {
    let query = db.select().from(messages);

    const conditions = [];
    if (filters.sessionId) conditions.push(eq(messages.sessionId, filters.sessionId));
    if (filters.userId) conditions.push(eq(messages.userId, filters.userId));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return await query
      .orderBy(desc(messages.createdAt))
      .limit(filters.limit)
      .offset(filters.offset) as any;
  }
}