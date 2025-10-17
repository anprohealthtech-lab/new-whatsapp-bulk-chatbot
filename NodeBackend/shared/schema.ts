import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

// Organizations table
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  subscriptionTier: varchar('subscription_tier', { length: 50 }).default('basic'),
  maxSessions: integer('max_sessions').default(1),
  maxUsersPerOrg: integer('max_users_per_org').default(5),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Enhanced Users table with multi-tenant support
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }),
  passwordHash: varchar('password_hash', { length: 255 }),
  role: varchar('role', { length: 50 }).default('user'), // 'admin', 'manager', 'user'
  organizationId: uuid('organization_id').references(() => organizations.id),
  isActive: boolean('is_active').default(true),
  lastLoginAt: timestamp('last_login_at'),
  sessionPreferences: jsonb('session_preferences'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  usernameIdx: index('username_idx').on(table.username),
  emailIdx: index('email_idx').on(table.email),
  orgIdIdx: index('org_id_idx').on(table.organizationId),
}));

// WhatsApp Sessions table
export const whatsappSessions = pgTable('whatsapp_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  sessionId: varchar('session_id', { length: 255 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 20 }),
  isAuthenticated: boolean('is_authenticated').default(false),
  isActive: boolean('is_active').default(false),
  strategy: varchar('strategy', { length: 50 }).default('business_hours'), // 'business_hours', 'always_on', 'on_demand'
  lastActivity: timestamp('last_activity').defaultNow(),
  connectionAttempts: integer('connection_attempts').default(0),
  qrCodeData: text('qr_code_data'),
  sessionData: jsonb('session_data'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  expiresAt: timestamp('expires_at'),
}, (table) => ({
  userIdIdx: index('session_user_id_idx').on(table.userId),
  sessionIdIdx: unique('session_id_unique').on(table.sessionId),
  phoneIdx: index('session_phone_idx').on(table.phoneNumber),
  activeIdx: index('session_active_idx').on(table.isActive),
}));

// Enhanced Messages table
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  sessionId: uuid('session_id').references(() => whatsappSessions.id),
  to: varchar('to', { length: 255 }).notNull(),
  content: text('content').notNull(),
  type: varchar('type', { length: 50 }).default('text'), // 'text', 'media', 'document'
  status: varchar('status', { length: 50 }).default('pending'), // 'pending', 'sent', 'delivered', 'read', 'failed'
  messageId: varchar('message_id', { length: 255 }),
  ackStatus: integer('ack_status').default(0),
  filePath: varchar('file_path', { length: 500 }),
  fileName: varchar('file_name', { length: 255 }),
  fileSize: integer('file_size'),
  mimeType: varchar('mime_type', { length: 100 }),
  metadata: jsonb('metadata'),
  templateData: jsonb('template_data'),
  retryCount: integer('retry_count').default(0),
  lastRetryAt: timestamp('last_retry_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  userIdIdx: index('msg_user_id_idx').on(table.userId),
  sessionIdIdx: index('msg_session_id_idx').on(table.sessionId),
  statusIdx: index('msg_status_idx').on(table.status),
  createdAtIdx: index('msg_created_at_idx').on(table.createdAt),
  messageIdIdx: index('msg_message_id_idx').on(table.messageId),
}));

// Usage Statistics table
export const usageStats = pgTable('usage_stats', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  sessionId: uuid('session_id').references(() => whatsappSessions.id),
  date: timestamp('date').defaultNow(),
  messagesSent: integer('messages_sent').default(0),
  messagesReceived: integer('messages_received').default(0),
  mediaFilesSent: integer('media_files_sent').default(0),
  sessionDuration: integer('session_duration').default(0), // in minutes
  apiCalls: integer('api_calls').default(0),
  errors: integer('errors').default(0),
  metadata: jsonb('metadata'),
}, (table) => ({
  userIdIdx: index('stats_user_id_idx').on(table.userId),
  orgIdIdx: index('stats_org_id_idx').on(table.organizationId),
  dateIdx: index('stats_date_idx').on(table.date),
}));

// System Logs table
export const systemLogs = pgTable('system_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  level: varchar('level', { length: 50 }).notNull(), // 'info', 'warn', 'error', 'debug'
  message: text('message').notNull(),
  service: varchar('service', { length: 100 }), // 'whatsapp', 'api', 'auth', 'database'
  userId: uuid('user_id').references(() => users.id),
  sessionId: uuid('session_id').references(() => whatsappSessions.id),
  metadata: jsonb('metadata'),
  timestamp: timestamp('timestamp').defaultNow(),
}, (table) => ({
  levelIdx: index('logs_level_idx').on(table.level),
  serviceIdx: index('logs_service_idx').on(table.service),
  timestampIdx: index('logs_timestamp_idx').on(table.timestamp),
  userIdIdx: index('logs_user_id_idx').on(table.userId),
}));

// Rate Limits table
export const rateLimits = pgTable('rate_limits', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  endpoint: varchar('endpoint', { length: 255 }).notNull(),
  count: integer('count').default(0),
  windowStart: timestamp('window_start').defaultNow(),
  windowEnd: timestamp('window_end').notNull(),
  limit: integer('limit').notNull(),
  metadata: jsonb('metadata'),
}, (table) => ({
  userEndpointIdx: unique('user_endpoint_window').on(table.userId, table.endpoint, table.windowStart),
  windowEndIdx: index('rate_limit_window_end_idx').on(table.windowEnd),
}));

// Zod schemas for validation
export const insertOrganizationSchema = createInsertSchema(organizations);
export const selectOrganizationSchema = createSelectSchema(organizations);

export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);

export const insertWhatsappSessionSchema = createInsertSchema(whatsappSessions);
export const selectWhatsappSessionSchema = createSelectSchema(whatsappSessions);

export const insertMessageSchema = createInsertSchema(messages);
export const selectMessageSchema = createSelectSchema(messages);

export const insertUsageStatsSchema = createInsertSchema(usageStats);
export const selectUsageStatsSchema = createSelectSchema(usageStats);

export const insertSystemLogSchema = createInsertSchema(systemLogs);
export const selectSystemLogSchema = createSelectSchema(systemLogs);

export const insertRateLimitSchema = createInsertSchema(rateLimits);
export const selectRateLimitSchema = createSelectSchema(rateLimits);

// Export types
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type WhatsappSession = typeof whatsappSessions.$inferSelect;
export type NewWhatsappSession = typeof whatsappSessions.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type UsageStats = typeof usageStats.$inferSelect;
export type NewUsageStats = typeof usageStats.$inferInsert;

export type SystemLog = typeof systemLogs.$inferSelect;
export type NewSystemLog = typeof systemLogs.$inferInsert;

export type RateLimit = typeof rateLimits.$inferSelect;
export type NewRateLimit = typeof rateLimits.$inferInsert;
