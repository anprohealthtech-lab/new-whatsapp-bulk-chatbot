import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

// Validation schemas for API endpoints
export const sendMessageSchema = z.object({
  phoneNumber: z.string().min(1, "Phone number is required"),
  content: z.string().min(1, "Message content is required"),
  templateData: z.record(z.string()).optional(),
});

export const sendReportSchema = z.object({
  phoneNumber: z.string().min(1, "Phone number is required"),
  sampleId: z.string().min(1, "Sample ID is required"),
  patientName: z.string().optional(),
  testName: z.string().optional(),
  content: z.string().optional(),
});

// Compatible Users table - matches external app structure exactly
export const users = pgTable('users', {
  // Core fields matching external app
  id: uuid('id').primaryKey(), // Same UUID as external app
  auth_id: uuid('auth_id'), // OAuth integration ID
  username: varchar('username', { length: 255 }).notNull().unique(), // Email-based
  password_hash: varchar('password_hash', { length: 255 }), // bcrypt hash
  name: varchar('name', { length: 255 }).notNull(), // Display name
  role: varchar('role', { length: 50 }).notNull(), // admin, receptionist, user
  
  // Clinic/Organization info (treating clinic as organization)
  clinic_name: varchar('clinic_name', { length: 255 }), // Organization name
  clinic_address: text('clinic_address'), // Full address
  gmb_link: varchar('gmb_link', { length: 500 }), // Google My Business
  logo: varchar('logo', { length: 500 }), // Logo URL
  primary_color: varchar('primary_color', { length: 7 }).default('#3b82f6'),
  secondary_color: varchar('secondary_color', { length: 7 }).default('#1e40af'),
  
  // Contact information
  contact_phone: varchar('contact_phone', { length: 20 }),
  contact_email: varchar('contact_email', { length: 255 }),
  contact_whatsapp: varchar('contact_whatsapp', { length: 20 }), // Business WhatsApp
  
  // Localization and features
  languages: jsonb('languages'), // Multi-language support
  default_language: varchar('default_language', { length: 5 }).default('en'),
  enabled_features: jsonb('enabled_features'), // Array of enabled features
  profile_types: jsonb('profile_types'), // Array of profile types
  
  // Integration settings
  google_sheet_id: varchar('google_sheet_id', { length: 255 }),
  google_apps_script_url: text('google_apps_script_url'),
  blueticks_api_key: varchar('blueticks_api_key', { length: 255 }),
  
  // WhatsApp LIMS specific fields
  whatsapp_integration_available: boolean('whatsapp_integration_available').default(true),
  max_sessions: integer('max_sessions').default(1), // Session limits
  session_preferences: jsonb('session_preferences'), // WhatsApp session config
  
  // Timestamps
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
  last_login_at: timestamp('last_login_at'),
}, (table) => ({
  usernameIdx: index('username_idx').on(table.username),
  emailIdx: index('contact_email_idx').on(table.contact_email),
  roleIdx: index('role_idx').on(table.role),
  whatsappAvailableIdx: index('whatsapp_available_idx').on(table.whatsapp_integration_available),
}));

// WhatsApp Sessions table - links to external app users via same ID
export const whatsappSessions = pgTable('whatsapp_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(), // Same ID as external app
  sessionId: varchar('session_id', { length: 255 }).notNull().unique(),
  
  // WhatsApp connection details
  phoneNumber: varchar('phone_number', { length: 20 }), // Connected WhatsApp number
  isAuthenticated: boolean('is_authenticated').default(false),
  isActive: boolean('is_active').default(false),
  
  // Session management
  strategy: varchar('strategy', { length: 50 }).default('business_hours'), // business_hours, always_on, on_demand
  lastActivity: timestamp('last_activity').defaultNow(),
  connectionAttempts: integer('connection_attempts').default(0),
  
  // QR Code and session data
  qrCodeData: text('qr_code_data'), // Base64 QR code
  sessionData: jsonb('session_data'), // Baileys auth state
  
  // Timestamps
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
