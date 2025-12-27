import express from 'express';
import { z } from 'zod';
import { multiWhatsAppService } from './services/MultiWhatsAppService.js';
import { multiUserWhatsAppService } from './services/MultiUserWhatsAppService.js';
import { messageService } from './services/MessageService.js';
import { fileService } from './services/FileService.js';
import { storage } from './storage.js';
import multer from 'multer';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB
    files: 1,
  },
});

// ========================================
// API Validation Schemas
// ========================================

const createUserSessionSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  organizationId: z.string().uuid('Invalid organization ID'),
  phoneNumber: z.string().optional(),
  strategy: z.enum(['business_hours', 'always_on', 'on_demand']).default('business_hours'),
  userInfo: z.object({
    username: z.string(),
    email: z.string().email().optional(),
    role: z.string(),
    organizationName: z.string().optional(),
  }),
});

const sendMessageSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  phoneNumber: z.string().min(10, 'Phone number must be at least 10 digits'),
  content: z.string().min(1, 'Message content is required'),
  templateData: z.record(z.string()).optional(),
});

const sendReportSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  phoneNumber: z.string().min(10, 'Phone number must be at least 10 digits'),
  content: z.string().min(1, 'Message content is required'),
  templateData: z.record(z.string()).optional(),
  fileName: z.string().optional(),
});

const sendReportFromUrlSchema = z.object({
  userId: z.string().min(1, 'User ID or username is required'),
  sessionId: z.string().uuid('Invalid session ID').optional(),
  phoneNumber: z.string().min(10, 'Phone number must be at least 10 digits'),
  fileUrl: z.string().url('Invalid file URL'),
  caption: z.string().optional(),
  templateData: z.record(z.string()).optional(),
  fileName: z.string().optional(),
});

const sendMessageUserSchema = z.object({
  userId: z.string().min(1, 'User ID or username is required'),
  sessionId: z.string().uuid('Invalid session ID').optional(),
  phoneNumber: z.string().min(10, 'Phone number must be at least 10 digits'),
  message: z.string().min(1, 'Message content is required'),
  templateData: z.record(z.string()).optional(),
});

const updateUserInfoSchema = z.object({
  userId: z.string().uuid(),
  username: z.string().optional(),
  email: z.string().email().optional(),
  role: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  organizationName: z.string().optional(),
});

// ========================================
// Helper Functions
// ========================================

/**
 * Resolve userId from either UUID or username
 * Accepts both formats: UUID string or username string
 */
async function resolveUserId(userIdOrUsername: string): Promise<{ userId: string; resolvedBy: 'uuid' | 'username' } | null> {
  // Check if it's a valid UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (uuidRegex.test(userIdOrUsername)) {
    // It's a UUID, use directly
    return { userId: userIdOrUsername, resolvedBy: 'uuid' };
  }
  
  // It's not a UUID, try to lookup by username
  try {
    const user = await storage.getUserByUsername(userIdOrUsername);
    if (user && user.id) {
      return { userId: user.id, resolvedBy: 'username' };
    }
  } catch (error) {
    console.error(`Failed to resolve username '${userIdOrUsername}':`, error);
  }
  
  return null;
}

// ========================================
// External API Authentication Middleware
// ========================================

const apiKeyAuth = (req: any, res: any, next: any) => {
  const apiKey = req.headers['x-api-key'];
  const expectedApiKey = process.env.API_KEY || 'whatsapp-lims-api-key-2024';
  
  if (!apiKey || apiKey !== expectedApiKey) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Valid API key required',
    });
  }
  
  next();
};

// ========================================
// User Synchronization APIs
// ========================================

/**
 * Sync Single User from External App
 * POST /api/external/users/sync
 */
router.post('/external/users/sync', apiKeyAuth, async (req, res) => {
  try {
    const userSyncSchema = z.object({
      id: z.string().uuid('Invalid user ID'),
      email: z.string().email('Invalid email'),
      username: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      clinic_name: z.string().optional(),
      contact_whatsapp: z.string().optional(),
      role: z.string().optional(),
      contact_phone: z.string().optional(),
      contact_email: z.string().email().optional(),
      is_active: z.boolean().default(true),
      whatsapp_enabled: z.boolean().default(false),
    });

    const validatedData = userSyncSchema.parse(req.body);
    
    // Upsert user in our system
    const user = await storage.upsertUser(validatedData);
    
    res.json({
      success: true,
      data: user,
      message: 'User synchronized successfully',
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: 'SYNC_ERROR',
      message: error.message,
    });
  }
});

/**
 * Bulk Sync Users from External App
 * POST /api/external/users/bulk-sync
 */
router.post('/external/users/bulk-sync', apiKeyAuth, async (req, res) => {
  try {
    const bulkSyncSchema = z.object({
      users: z.array(z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        username: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        clinic_name: z.string().optional(),
        contact_whatsapp: z.string().optional(),
        role: z.string().optional(),
        contact_phone: z.string().optional(),
        contact_email: z.string().email().optional(),
        is_active: z.boolean().default(true),
        whatsapp_enabled: z.boolean().default(false),
      })),
    });

    const validatedData = bulkSyncSchema.parse(req.body);
    
    const results = [];
    for (const userData of validatedData.users) {
      try {
        const user = await storage.upsertUser(userData);
        results.push({ success: true, userId: userData.id, user });
      } catch (error: any) {
        results.push({ 
          success: false, 
          userId: userData.id, 
          error: error.message 
        });
      }
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    res.json({
      success: true,
      data: {
        total: validatedData.users.length,
        successful,
        failed,
        results,
      },
      message: `Synchronized ${successful} users, ${failed} failed`,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: 'BULK_SYNC_ERROR',
      message: error.message,
    });
  }
});

/**
 * Get Synchronized Users
 * GET /api/external/users
 */
router.get('/external/users', apiKeyAuth, async (req, res) => {
  try {
    const users = await storage.getAllUsers();
    
    res.json({
      success: true,
      data: users,
      message: 'Users retrieved successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'FETCH_ERROR',
      message: error.message,
    });
  }
});

// ========================================
// Session Management APIs
// ========================================

/**
 * Create WhatsApp Session for External User
 * POST /api/external/sessions/create
 */
router.post('/external/sessions/create', apiKeyAuth, async (req, res) => {
  try {
    const validatedData = createUserSessionSchema.parse(req.body);
    
    // Store user info in our system
    await storage.syncExternalUser({
      id: validatedData.userId,
      username: validatedData.userInfo.username,
      contact_email: validatedData.userInfo.email,
      role: validatedData.userInfo.role,
      clinic_name: validatedData.userInfo.organizationName,
      isExternal: true,
    });
    
    // Create WhatsApp session
    const session = await multiWhatsAppService.createSession({
      userId: validatedData.userId,
      strategy: validatedData.strategy,
      phoneNumber: validatedData.phoneNumber,
    });
    
    // Get QR code if available
    const qrCode = session.qrCode;
    
    res.json({
      success: true,
      data: {
        sessionId: session.id,
        userId: validatedData.userId,
        strategy: validatedData.strategy,
        qrCode: qrCode,
        qrCodeUrl: qrCode ? `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrCode)}` : null,
        status: session.isActive ? 'active' : 'inactive',
        isAuthenticated: session.isAuthenticated,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: error.message,
    });
  }
});

/**
 * Get Session Status and Health
 * GET /api/external/sessions/:sessionId/status
 */
router.get('/external/sessions/:sessionId/status', apiKeyAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = multiWhatsAppService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found',
      });
    }
    
    // Get session health metrics
    const healthMetrics = multiWhatsAppService.getSessionHealth(sessionId);
    
    res.json({
      success: true,
      data: {
        sessionId,
        userId: session.userId,
        phoneNumber: session.phoneNumber,
        isActive: session.isActive,
        isAuthenticated: session.isAuthenticated,
        status: session.isAuthenticated ? 'connected' : (session.isActive ? 'connecting' : 'disconnected'),
        lastActivity: session.lastActivity,
        connectionAttempts: session.connectionAttempts,
        strategy: session.sessionStrategy.name,
        health: healthMetrics,
        qrCode: session.qrCode,
        qrCodeUrl: session.qrCode ? `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(session.qrCode)}` : null,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message,
    });
  }
});

/**
 * Get Fresh QR Code for Session
 * GET /api/external/sessions/:sessionId/qr
 */
router.get('/external/sessions/:sessionId/qr', apiKeyAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = multiWhatsAppService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found',
      });
    }
    
    // Generate fresh QR if needed
    const qrCode = await multiWhatsAppService.refreshQRCode(sessionId);
    
    res.json({
      success: true,
      data: {
        sessionId,
        qrCode: qrCode,
        qrCodeUrl: qrCode ? `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrCode)}` : null,
        isAuthenticated: session.isAuthenticated,
        status: session.isAuthenticated ? 'connected' : 'waiting_for_scan',
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message,
    });
  }
});

/**
 * Disconnect Session
 * DELETE /api/external/sessions/:sessionId
 */
router.delete('/external/sessions/:sessionId', apiKeyAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const result = await multiWhatsAppService.disconnectSession(sessionId);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found',
      });
    }
    
    res.json({
      success: true,
      message: 'Session disconnected successfully',
      data: {
        sessionId,
        disconnectedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message,
    });
  }
});

// ========================================
// Message Sending APIs
// ========================================

/**
 * Send Text Message
 * POST /api/external/messages/send
 */
router.post('/external/messages/send', apiKeyAuth, async (req, res) => {
  try {
    const validatedData = sendMessageSchema.parse(req.body);
    
    const session = multiWhatsAppService.getSession(validatedData.sessionId);
    if (!session || !session.isAuthenticated) {
      return res.status(400).json({
        success: false,
        error: 'SESSION_NOT_READY',
        message: 'Session is not connected to WhatsApp',
      });
    }
    
    // Process template data if provided
    let processedContent = validatedData.content;
    if (validatedData.templateData) {
      Object.entries(validatedData.templateData).forEach(([key, value]) => {
        processedContent = processedContent.replace(new RegExp(`\\[${key}\\]`, 'g'), value);
      });
    }
    
    const messageResult = await multiWhatsAppService.sendMessage(
      validatedData.sessionId,
      validatedData.phoneNumber,
      processedContent
    );
    
    res.json({
      success: true,
      data: {
        messageId: messageResult.messageId,
        sessionId: validatedData.sessionId,
        to: validatedData.phoneNumber,
        content: processedContent,
        status: messageResult.status,
        sentAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: 'MESSAGE_SEND_FAILED',
      message: error.message,
    });
  }
});

/**
 * Send Text Message (User-based)
 * POST /api/external/messages/send-user
 */
router.post('/external/messages/send-user', apiKeyAuth, async (req, res) => {
  try {
    const validatedData = sendMessageUserSchema.parse(req.body);

    // Resolve userId from UUID or username
    const resolved = await resolveUserId(validatedData.userId);
    if (!resolved) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: `User not found: ${validatedData.userId}`,
      });
    }

    const userId = resolved.userId;
    const userSessions = multiUserWhatsAppService.getUserSessions(userId);
    const activeSession = userSessions.find(session => session.isConnected) || userSessions[0];

    if (validatedData.sessionId && activeSession && validatedData.sessionId !== activeSession.sessionId) {
      return res.status(409).json({
        success: false,
        error: 'SESSION_MISMATCH',
        message: 'Provided sessionId does not match active user session',
      });
    }

    if (!activeSession) {
      const status = multiUserWhatsAppService.getUserSessionStatus(validatedData.userId);
      return res.status(status?.isAuthenticated ? 409 : 404).json({
        success: false,
        error: status?.isAuthenticated ? 'SESSION_NOT_READY' : 'SESSION_NOT_FOUND',
        message: status?.isAuthenticated
          ? 'User has an authenticated session that is currently disconnected'
          : 'No WhatsApp session found for this user',
      });
    }

    if (!activeSession.isConnected) {
      return res.status(409).json({
        success: false,
        error: 'SESSION_NOT_READY',
        message: 'User session is not connected to WhatsApp',
      });
    }

    const sendResult = await multiUserWhatsAppService.sendMessageFromUser(
      userId,
      validatedData.phoneNumber,
      validatedData.message,
      validatedData.templateData
    );

    if (!sendResult.success) {
      throw new Error(sendResult.error || 'Failed to send message');
    }

    await storage.createSystemLog({
      level: 'info',
      message: 'Message sent via external user-based endpoint',
      service: 'whatsapp',
      metadata: {
        userId: userId,
        userIdInput: validatedData.userId,
        resolvedBy: resolved.resolvedBy,
        sessionId: activeSession.sessionId,
        phoneNumber: validatedData.phoneNumber,
        messageLength: validatedData.message.length,
      },
    });

    return res.json({
      success: true,
      message: 'Message sent successfully',
      data: {
        messageId: sendResult.messageId,
        sessionId: activeSession.sessionId,
        userId: userId,
        userIdInput: validatedData.userId,
        resolvedBy: resolved.resolvedBy,
        to: validatedData.phoneNumber,
        sentAt: new Date().toISOString(),
        sessionWasAutoSelected: !validatedData.sessionId,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: error.flatten(),
      });
    }

    console.error('User message send failed:', error);

    return res.status(500).json({
      success: false,
      error: 'MESSAGE_SEND_FAILED',
      message: error?.message || 'Failed to send message',
    });
  }
});

/**
 * Send Report with File
 * POST /api/external/reports/send
 */
router.post('/external/reports/send', apiKeyAuth, upload.single('file'), async (req, res) => {
  try {
    const validatedData = sendReportSchema.parse({
      ...req.body,
      fileName: req.file?.originalname,
    });
    
    const session = multiWhatsAppService.getSession(validatedData.sessionId);
    if (!session || !session.isAuthenticated) {
      return res.status(400).json({
        success: false,
        error: 'SESSION_NOT_READY',
        message: 'Session is not connected to WhatsApp',
      });
    }
    
    // Process template data
    let processedContent = validatedData.content;
    if (validatedData.templateData) {
      Object.entries(validatedData.templateData).forEach(([key, value]) => {
        processedContent = processedContent.replace(new RegExp(`\\[${key}\\]`, 'g'), value);
      });
    }
    
    let messageResult;
    
    if (req.file) {
      // Validate and save file
      const fileValidation = fileService.validateFile(req.file);
      if (!fileValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: 'FILE_VALIDATION_FAILED',
          message: fileValidation.error,
        });
      }
      
      const savedFile = await fileService.saveFile(req.file);
      
      // Send file message
      messageResult = await multiWhatsAppService.sendDocument(
        validatedData.sessionId,
        validatedData.phoneNumber,
        savedFile.filePath,
        processedContent,
        savedFile.fileName
      );
    } else {
      // Send text message only
      messageResult = await multiWhatsAppService.sendMessage(
        validatedData.sessionId,
        validatedData.phoneNumber,
        processedContent
      );
    }
    
    res.json({
      success: true,
      data: {
        messageId: messageResult.messageId,
        sessionId: validatedData.sessionId,
        to: validatedData.phoneNumber,
        content: processedContent,
        fileName: validatedData.fileName,
        status: messageResult.status,
        sentAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: 'REPORT_SEND_FAILED',
      message: error.message,
    });
  }
});

/**
 * Send Report using remote file URL
 * POST /api/external/reports/send-url
 */
router.post('/external/reports/send-url', apiKeyAuth, async (req, res) => {
  let tempFilePath: string | null = null;

  try {
    const validatedData = sendReportFromUrlSchema.parse(req.body);

    // Resolve userId from UUID or username
    const resolved = await resolveUserId(validatedData.userId);
    if (!resolved) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: `User not found: ${validatedData.userId}`,
      });
    }

    const userId = resolved.userId;
    const userSessions = multiUserWhatsAppService.getUserSessions(userId);
    const activeSession = userSessions.find(session => session.isConnected) || userSessions[0];

    if (validatedData.sessionId && activeSession && validatedData.sessionId !== activeSession.sessionId) {
      return res.status(409).json({
        success: false,
        error: 'SESSION_MISMATCH',
        message: 'Provided sessionId does not match active user session',
      });
    }

    if (!activeSession) {
      const status = multiUserWhatsAppService.getUserSessionStatus(validatedData.userId);
      return res.status(status?.isAuthenticated ? 409 : 404).json({
        success: false,
        error: status?.isAuthenticated ? 'SESSION_NOT_READY' : 'SESSION_NOT_FOUND',
        message: status?.isAuthenticated
          ? 'User has an authenticated session that is currently disconnected'
          : 'No WhatsApp session found for this user',
      });
    }

    if (!activeSession.isConnected) {
      return res.status(409).json({
        success: false,
        error: 'SESSION_NOT_READY',
        message: 'User session is not connected to WhatsApp',
      });
    }

    const savedFile = await fileService.downloadAndSaveFile(
      validatedData.fileUrl,
      userId,
      validatedData.fileName
    );

    tempFilePath = savedFile.path;

    let processedCaption = validatedData.caption ?? 'Your lab report is ready';
    const templateEntries = Object.entries({
      ReportDate: new Date().toLocaleDateString(),
      ...(validatedData.templateData || {}),
    });

    templateEntries.forEach(([key, value]) => {
      processedCaption = processedCaption.replace(new RegExp(`\\[${key}\\]`, 'g'), value);
    });

    const sendResult = await multiUserWhatsAppService.sendDocumentFromUser(
      userId,
      validatedData.phoneNumber,
      savedFile.path,
      processedCaption,
      validatedData.templateData
    );

    if (!sendResult.success) {
      throw new Error(sendResult.error || 'Failed to send file');
    }

    await storage.createSystemLog({
      level: 'info',
      message: 'File sent via external URL endpoint',
      service: 'whatsapp',
      metadata: {
        userId: userId,
        userIdInput: validatedData.userId,
        resolvedBy: resolved.resolvedBy,
        sessionId: activeSession.sessionId,
        phoneNumber: validatedData.phoneNumber,
        fileUrl: validatedData.fileUrl,
        fileName: savedFile.name,
        fileSize: savedFile.size,
      },
    });

    return res.json({
      success: true,
      message: 'File sent successfully',
      data: {
        messageId: sendResult.messageId,
        sessionId: activeSession.sessionId,
        userId: userId,
        userIdInput: validatedData.userId,
        resolvedBy: resolved.resolvedBy,
        to: validatedData.phoneNumber,
        caption: processedCaption,
        fileName: validatedData.fileName || savedFile.name,
        fileSize: savedFile.size,
        sentAt: new Date().toISOString(),
        sessionWasAutoSelected: !validatedData.sessionId,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: error.flatten(),
      });
    }

    console.error('Report send via URL failed:', error);

    const statusCode = typeof error?.message === 'string' && error.message.toLowerCase().includes('download')
      ? 424
      : 500;

    return res.status(statusCode).json({
      success: false,
      error: 'REPORT_URL_SEND_FAILED',
      message: error?.message || 'Failed to send report using URL',
    });
  } finally {
    if (tempFilePath) {
      await fileService.deleteFile(tempFilePath);
    }
  }
});

// ========================================
// User & Organization Sync APIs
// ========================================

/**
 * Update User Information
 * PUT /api/external/users/:userId
 */
router.put('/external/users/:userId', apiKeyAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const validatedData = updateUserInfoSchema.parse({ ...req.body, userId });
    
    // Map the validated data to our user schema
    const userData = {
      id: validatedData.userId,
      username: validatedData.username,
      contact_email: validatedData.email,
      role: validatedData.role,
      clinic_name: validatedData.organizationName,
    };
    
    await storage.syncExternalUser(userData);
    
    res.json({
      success: true,
      message: 'User information updated successfully',
      data: {
        userId,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: 'USER_UPDATE_FAILED',
      message: error.message,
    });
  }
});

/**
 * Get User Sessions
 * GET /api/external/users/:userId/sessions
 */
router.get('/external/users/:userId/sessions', apiKeyAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const userSessions = multiWhatsAppService.getUserActiveSessions(userId);
    
    const sessionsData = userSessions.map(session => ({
      sessionId: session.id,
      phoneNumber: session.phoneNumber,
      isActive: session.isActive,
      isAuthenticated: session.isAuthenticated,
      status: session.isAuthenticated ? 'connected' : (session.isActive ? 'connecting' : 'disconnected'),
      strategy: session.sessionStrategy.name,
      lastActivity: session.lastActivity,
      connectionAttempts: session.connectionAttempts,
    }));
    
    res.json({
      success: true,
      data: {
        userId,
        sessions: sessionsData,
        totalSessions: sessionsData.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: error.message,
    });
  }
});

// ========================================
// Health & Monitoring APIs
// ========================================

/**
 * System Health Check
 * GET /api/external/health
 */
router.get('/external/health', apiKeyAuth, async (req, res) => {
  try {
    const systemStatus = multiWhatsAppService.getSystemStatus();
    
    res.json({
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        system: systemStatus,
        version: '1.0.0',
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'HEALTH_CHECK_FAILED',
      message: error.message,
    });
  }
});

/**
 * Get Message History
 * GET /api/external/messages/history
 */
router.get('/external/messages/history', apiKeyAuth, async (req, res) => {
  try {
    const { sessionId, userId, limit = 50, offset = 0 } = req.query;
    
    const messages = await storage.getMessageHistory({
      sessionId: sessionId as string,
      userId: userId as string,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
    
    res.json({
      success: true,
      data: {
        messages,
        total: messages.length,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'HISTORY_FETCH_FAILED',
      message: error.message,
    });
  }
});

// ========================================
// Session Health & Monitoring APIs
// ========================================

/**
 * Get Health Status of All WhatsApp Sessions
 * GET /api/external/sessions/health
 * Returns all active sessions with their status for external monitoring
 */
router.get('/external/sessions/health', apiKeyAuth, async (req, res) => {
  try {
    const sessions = multiUserWhatsAppService.getSessionsHealth();
    const activeSessions = sessions.filter(s => s.isConnected && s.isAuthenticated);
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalSessions: sessions.length,
      activeSessions: activeSessions.length,
      sessions: sessions
    });
  } catch (error: any) {
    console.error('Error getting sessions health:', error);
    res.status(500).json({
      success: false,
      error: 'HEALTH_CHECK_FAILED',
      message: error.message
    });
  }
});

/**
 * Pulse Check for Specific User
 * POST /api/external/sessions/pulse
 * External apps can call periodically to verify session is alive
 * Body: { userId: "uuid-or-username" }
 */
router.post('/external/sessions/pulse', apiKeyAuth, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_USER_ID',
        message: 'userId is required'
      });
    }

    // Resolve userId (supports both UUID and username)
    const resolved = await resolveUserId(userId);
    if (!resolved) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: `User not found: ${userId}`
      });
    }

    const pulse = await multiUserWhatsAppService.pulseCheck(resolved.userId);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      userIdInput: userId,
      resolvedBy: resolved.resolvedBy,
      ...pulse
    });
  } catch (error: any) {
    console.error('Error checking pulse:', error);
    res.status(500).json({
      success: false,
      error: 'PULSE_CHECK_FAILED',
      message: error.message
    });
  }
});

/**
 * Bulk Pulse Check for Multiple Users
 * POST /api/external/sessions/bulk-pulse
 * Check multiple user sessions at once
 * Body: { userIds: ["uuid1", "username2", ...] }
 */
router.post('/external/sessions/bulk-pulse', apiKeyAuth, async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_USER_IDS',
        message: 'userIds array is required'
      });
    }

    const results = [];
    for (const userId of userIds) {
      try {
        const resolved = await resolveUserId(userId);
        if (resolved) {
          const pulse = await multiUserWhatsAppService.pulseCheck(resolved.userId);
          results.push({
            userIdInput: userId,
            resolvedBy: resolved.resolvedBy,
            ...pulse
          });
        } else {
          results.push({
            userIdInput: userId,
            alive: false,
            error: 'USER_NOT_FOUND'
          });
        }
      } catch (err: any) {
        results.push({
          userIdInput: userId,
          alive: false,
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalChecked: userIds.length,
      aliveCount: results.filter(r => r.alive).length,
      results
    });
  } catch (error: any) {
    console.error('Error checking bulk pulse:', error);
    res.status(500).json({
      success: false,
      error: 'BULK_PULSE_FAILED',
      message: error.message
    });
  }
});

/**
 * Disconnect a User's WhatsApp Session
 * POST /api/external/sessions/disconnect
 * External apps can disconnect a user's session
 * Body: { userId: "uuid-or-username" }
 */
router.post('/external/sessions/disconnect', apiKeyAuth, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_USER_ID',
        message: 'userId is required'
      });
    }

    // Resolve userId
    const resolved = await resolveUserId(userId);
    if (!resolved) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: `User not found: ${userId}`
      });
    }

    const disconnected = await multiUserWhatsAppService.disconnectUserSession(resolved.userId);

    if (disconnected) {
      res.json({
        success: true,
        message: 'Session disconnected successfully',
        userId: resolved.userId,
        userIdInput: userId,
        resolvedBy: resolved.resolvedBy,
        authPreserved: true
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'No active session found for this user'
      });
    }
  } catch (error: any) {
    console.error('Error disconnecting session:', error);
    res.status(500).json({
      success: false,
      error: 'DISCONNECT_FAILED',
      message: error.message
    });
  }
});

export { router as externalApiRoutes };