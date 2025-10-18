import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, messages, systemLogs, whatsappSessions } from '@shared/schema';
import type { User, NewUser, Message, NewMessage, SystemLog, NewSystemLog, WhatsappSession, NewWhatsappSession } from '@shared/schema';
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
  async upsertUser(userData: any): Promise<User> {
    // Check if user exists
    const existingUser = await this.getUser(userData.id);
    
    if (existingUser) {
      // Update existing user with only provided fields
      const updateData: any = {
        updated_at: new Date(),
      };
      
      // Map external app fields to our schema
      if (userData.username !== undefined) updateData.username = userData.username;
      if (userData.email !== undefined) updateData.contact_email = userData.email;
      if (userData.first_name !== undefined || userData.last_name !== undefined) {
        updateData.name = `${userData.first_name || ''} ${userData.last_name || ''}`.trim();
      }
      if (userData.clinic_name !== undefined) updateData.clinic_name = userData.clinic_name;
      if (userData.contact_whatsapp !== undefined) updateData.contact_whatsapp = userData.contact_whatsapp;
      if (userData.role !== undefined) updateData.role = userData.role;
      if (userData.contact_phone !== undefined) updateData.contact_phone = userData.contact_phone;
      if (userData.contact_email !== undefined) updateData.contact_email = userData.contact_email;
      if (userData.whatsapp_enabled !== undefined) updateData.whatsapp_integration_available = userData.whatsapp_enabled;
      
      const result = await db.update(users)
        .set(updateData)
        .where(eq(users.id, userData.id))
        .returning();
      return result[0];
    } else {
      // Create new user with required fields
      const newUser: any = {
        id: userData.id,
        username: userData.username || userData.email || `user_${userData.id.slice(0, 8)}`,
        name: userData.first_name && userData.last_name 
          ? `${userData.first_name} ${userData.last_name}` 
          : userData.username || 'External User',
        role: userData.role || 'user',
        contact_email: userData.email || userData.contact_email,
        clinic_name: userData.clinic_name,
        contact_whatsapp: userData.contact_whatsapp,
        contact_phone: userData.contact_phone,
        whatsapp_integration_available: userData.whatsapp_enabled ?? true,
      };
      
      const result = await db.insert(users).values(newUser).returning();
      return result[0];
    }
  }

  async syncExternalUser(userData: Partial<NewUser> & { id: string, isExternal?: boolean }): Promise<User> {
    return await this.upsertUser(userData);
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.created_at));
  }

  async updateUserLastLogin(userId: string): Promise<void> {
    await db.update(users)
      .set({ last_login_at: new Date() })
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