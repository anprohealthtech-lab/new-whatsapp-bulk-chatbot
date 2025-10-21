import { type User, type InsertUser, type Message, type InsertMessage, type SystemLog, type InsertSystemLog } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  upsertUser(userData: any): Promise<User>;
  syncExternalUser(userData: any): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUserLastLogin(userId: string): Promise<void>;

  // Message methods
  getMessage(id: string): Promise<Message | undefined>;
  getMessages(filters?: { status?: string; phoneNumber?: string; type?: string; limit?: number; offset?: number }): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  updateMessage(id: string, updates: Partial<Message>): Promise<Message | undefined>;
  getMessagesCount(filters?: { status?: string; phoneNumber?: string; type?: string }): Promise<number>;
  getMessagesByDateRange(startDate: Date, endDate: Date): Promise<Message[]>;
  getMessageHistory(filters: { sessionId?: string; userId?: string; limit: number; offset: number }): Promise<Message[]>;

  // System log methods
  getSystemLogs(limit?: number, offset?: number): Promise<SystemLog[]>;
  createSystemLog(log: InsertSystemLog): Promise<SystemLog>;

  // Multi-User WhatsApp Session methods
  getUserActiveSessions(userId: string): Promise<any[]>;
  getAllActiveWhatsAppSessions(): Promise<any[]>;
  getAllWhatsAppSessions(): Promise<any[]>;
  updateUserWhatsAppSession(userId: string, updates: any): Promise<void>;
  createWhatsAppSession(session: any): Promise<any>;
  getWhatsAppSessionsByUserId(userId: string): Promise<any[]>;
  deactivateOtherUserSessions(userId: string, currentSessionId: string): Promise<void>;
  deleteWhatsAppSession(sessionId: string): Promise<void>;
  deleteWhatsAppSessionsByUserId(userId: string, exceptSessionId?: string): Promise<number>;
  cleanupFailedSessions(): Promise<number>;
  cleanupOrphanedSessions(maxAgeDays?: number): Promise<number>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private messages: Map<string, Message>;
  private systemLogs: Map<string, SystemLog>;

  constructor() {
    this.users = new Map();
    this.messages = new Map();
    this.systemLogs = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.username === username);
  }

  // Multi-User WhatsApp Session methods (stub implementations)
  async getUserActiveSessions(userId: string): Promise<any[]> {
    return [];
  }

  async getAllActiveWhatsAppSessions(): Promise<any[]> {
    return [];
  }

  async getAllWhatsAppSessions(): Promise<any[]> {
    return [];
  }

  async updateUserWhatsAppSession(userId: string, updates: any): Promise<void> {
    // Stub implementation
  }

  async createWhatsAppSession(session: any): Promise<any> {
    return session;
  }

  async getWhatsAppSessionsByUserId(userId: string): Promise<any[]> {
    return [];
  }

  async deactivateOtherUserSessions(userId: string, currentSessionId: string): Promise<void> {
    // Stub implementation for memory storage
  }

  async deleteWhatsAppSession(sessionId: string): Promise<void> {
    // Stub implementation for memory storage
  }

  async deleteWhatsAppSessionsByUserId(userId: string, exceptSessionId?: string): Promise<number> {
    return 0;
  }

  async cleanupFailedSessions(): Promise<number> {
    return 0;
  }

  async cleanupOrphanedSessions(maxAgeDays?: number): Promise<number> {
    return 0;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getMessage(id: string): Promise<Message | undefined> {
    return this.messages.get(id);
  }

  async getMessages(filters?: { status?: string; phoneNumber?: string; type?: string; limit?: number; offset?: number }): Promise<Message[]> {
    let messages = Array.from(this.messages.values());

    if (filters?.status) {
      messages = messages.filter(msg => msg.status === filters.status);
    }
    if (filters?.phoneNumber) {
      messages = messages.filter(msg => msg.phoneNumber === filters.phoneNumber);
    }
    if (filters?.type) {
      messages = messages.filter(msg => msg.type === filters.type);
    }

    // Sort by creation date (newest first)
    messages.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    const offset = filters?.offset || 0;
    const limit = filters?.limit || messages.length;
    
    return messages.slice(offset, offset + limit);
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const id = randomUUID();
    const message: Message = {
      ...insertMessage,
      id,
      metadata: insertMessage.metadata || null,
      createdAt: new Date(),
      sentAt: null,
      deliveredAt: null,
    };
    this.messages.set(id, message);
    return message;
  }

  async updateMessage(id: string, updates: Partial<Message>): Promise<Message | undefined> {
    const existing = this.messages.get(id);
    if (!existing) return undefined;

    const updated = { ...existing, ...updates };
    this.messages.set(id, updated);
    return updated;
  }

  async getMessagesCount(filters?: { status?: string; phoneNumber?: string; type?: string }): Promise<number> {
    const messages = await this.getMessages(filters);
    return messages.length;
  }

  async getMessagesByDateRange(startDate: Date, endDate: Date): Promise<Message[]> {
    return Array.from(this.messages.values()).filter(msg => {
      if (!msg.createdAt) return false;
      const msgDate = new Date(msg.createdAt);
      return msgDate >= startDate && msgDate <= endDate;
    });
  }

  async getSystemLogs(limit = 50, offset = 0): Promise<SystemLog[]> {
    const logs = Array.from(this.systemLogs.values());
    logs.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    
    return logs.slice(offset, offset + limit);
  }

  async createSystemLog(insertLog: InsertSystemLog): Promise<SystemLog> {
    const id = randomUUID();
    const log: SystemLog = {
      ...insertLog,
      id,
      metadata: insertLog.metadata || null,
      createdAt: new Date(),
    };
    this.systemLogs.set(id, log);
    return log;
  }

  // Additional user methods
  async upsertUser(userData: any): Promise<User> {
    const existingUser = await this.getUser(userData.id);
    if (existingUser) {
      // Update existing user
      const updated = { ...existingUser, ...userData };
      this.users.set(userData.id, updated);
      return updated;
    } else {
      // Create new user
      return await this.createUser(userData);
    }
  }

  async syncExternalUser(userData: any): Promise<User> {
    return await this.upsertUser(userData);
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async updateUserLastLogin(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.last_login_at = new Date();
      this.users.set(userId, user);
    }
  }

  async getMessageHistory(filters: { sessionId?: string; userId?: string; limit: number; offset: number }): Promise<Message[]> {
    let messages = Array.from(this.messages.values());

    if (filters.sessionId) {
      messages = messages.filter(msg => msg.sessionId === filters.sessionId);
    }
    if (filters.userId) {
      messages = messages.filter(msg => msg.userId === filters.userId);
    }

    // Sort by creation date (newest first)
    messages.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    return messages.slice(filters.offset, filters.offset + filters.limit);
  }
}

// Use database storage when DATABASE_URL is available
import { DatabaseStorage } from './storage/DatabaseStorage';

export const storage = process.env.DATABASE_URL 
  ? new DatabaseStorage()
  : new MemStorage();
