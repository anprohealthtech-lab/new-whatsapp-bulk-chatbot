import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

import { pgTable, text, timestamp, boolean, integer, real } from 'drizzle-orm/pg-core';

// Organizations/Companies table
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  phone: text('phone'),
  address: text('address'),
  subscriptionPlan: text('subscription_plan').default('basic'), // 'basic' | 'professional' | 'enterprise'
  maxUsers: integer('max_users').default(1),
  maxSessions: integer('max_sessions').default(1),
  maxMessagesPerDay: integer('max_messages_per_day').default(100),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Enhanced users table with multi-tenant support
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').unique(),
  passwordHash: text('password_hash').notNull(),
  organizationId: text('organization_id').references(() => organizations.id),
  role: text('role').default('user'), // 'admin' | 'manager' | 'user'
  maxSessions: integer('max_sessions').default(1),
  isActive: boolean('is_active').default(true),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// WhatsApp sessions management
export const whatsappSessions = pgTable('whatsapp_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  phoneNumber: text('phone_number'),
  sessionData: text('session_data'), // Encrypted session state
  isActive: boolean('is_active').default(false),
  isAuthenticated: boolean('is_authenticated').default(false),
  qrCode: text('qr_code'),
  connectionAttempts: integer('connection_attempts').default(0),
  lastActivity: timestamp('last_activity'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  expiresAt: timestamp('expires_at'),
  reconnectCount: integer('reconnect_count').default(0),
  sessionStrategy: text('session_strategy').default('business_hours'), // 'business_hours' | 'always_on' | 'on_demand'
});

// Enhanced messages table with user context
export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  sessionId: text('session_id').references(() => whatsappSessions.id),
  phoneNumber: text('phone_number').notNull(),
  content: text('content').notNull(),
  type: text('type').notNull(), // 'text' | 'report' | 'media'
  status: text('status').notNull(), // 'pending' | 'sent' | 'delivered' | 'failed'
  fileUrl: text('file_url'),
  fileName: text('file_name'),
  fileSize: integer('file_size'),
  sampleId: text('sample_id'),
  patientName: text('patient_name'),
  doctorName: text('doctor_name'),
  labName: text('lab_name'),
  reportDate: text('report_date'),
  priority: text('priority').default('normal'), // 'low' | 'normal' | 'high' | 'urgent'
  metadata: text('metadata'), // JSON string for additional data
  createdAt: timestamp('created_at').defaultNow(),
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  failedAt: timestamp('failed_at'),
  retryCount: integer('retry_count').default(0),
});

// Rate limiting and usage tracking
export const usageStats = pgTable('usage_stats', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  date: text('date').notNull(), // YYYY-MM-DD format
  messagesCount: integer('messages_count').default(0),
  mediaFilesCount: integer('media_files_count').default(0),
  sessionsCount: integer('sessions_count').default(0),
  totalFileSize: integer('total_file_size').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// API keys for external integration
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  key: text('key').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  permissions: text('permissions'), // JSON array of permissions
  rateLimitPerHour: integer('rate_limit_per_hour').default(1000),
  isActive: boolean('is_active').default(true),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Enhanced system logs with user context
export const systemLogs = pgTable('system_logs', {
  id: text('id').primaryKey(),
  level: text('level').notNull(), // 'info' | 'warn' | 'error' | 'debug'
  message: text('message').notNull(),
  userId: text('user_id').references(() => users.id),
  sessionId: text('session_id').references(() => whatsappSessions.id),
  component: text('component'), // 'whatsapp' | 'api' | 'auth' | 'system'
  metadata: text('metadata'), // JSON string
  createdAt: timestamp('created_at').defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
  sentAt: true,
  deliveredAt: true,
});

export const insertSystemLogSchema = createInsertSchema(systemLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertSystemLog = z.infer<typeof insertSystemLogSchema>;
export type SystemLog = typeof systemLogs.$inferSelect;

// Additional schemas for API requests
export const sendMessageSchema = z.object({
  phoneNumber: z.string().min(1, "Phone number is required"),
  content: z.string().min(1, "Message content is required"),
});

export const sendReportSchema = z.object({
  phoneNumber: z.string().min(1, "Phone number is required"),
  sampleId: z.string().min(1, "Sample ID is required"),
  content: z.string().optional(),
});

export type SendMessageRequest = z.infer<typeof sendMessageSchema>;
export type SendReportRequest = z.infer<typeof sendReportSchema>;
