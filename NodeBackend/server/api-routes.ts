import express from 'express';
import { z } from 'zod';
import { multiWhatsAppService } from './services/MultiWhatsAppService.js';
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
  userId: z.string().uuid('Invalid user ID'),
  sessionId: z.string().uuid('Invalid session ID').optional(),
  phoneNumber: z.string().min(10, 'Phone number must be at least 10 digits'),
  fileUrl: z.string().url('Invalid file URL'),
  caption: z.string().optional(),
  templateData: z.record(z.string()).optional(),
  fileName: z.string().optional(),
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

    let targetSession = validatedData.sessionId
      ? multiWhatsAppService.getSession(validatedData.sessionId)
      : undefined;

    if (validatedData.sessionId && !targetSession) {
      return res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found',
      });
    }

    if (!targetSession) {
      const userSessions = multiWhatsAppService.getUserActiveSessions(validatedData.userId);
      const candidateSession = userSessions.find(session => session.isAuthenticated) || userSessions[0];

      if (candidateSession?.id) {
        targetSession = multiWhatsAppService.getSession(candidateSession.id);
      }
    }

    if (!targetSession) {
      const fallbackSessions = multiWhatsAppService
        .getAllSessions()
        .filter(session => session.userId === validatedData.userId && session.isAuthenticated);

      if (fallbackSessions.length > 0) {
        targetSession = multiWhatsAppService.getSession(fallbackSessions[0].id);
      }
    }

    if (!targetSession) {
      return res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'No active WhatsApp session found for this user',
      });
    }

    if (!targetSession.isAuthenticated) {
      return res.status(409).json({
        success: false,
        error: 'SESSION_NOT_READY',
        message: 'Session is not connected to WhatsApp',
      });
    }

    const savedFile = await fileService.downloadAndSaveFile(
      validatedData.fileUrl,
      validatedData.userId,
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

    const messageResult = await multiWhatsAppService.sendMediaMessage(
      targetSession.id,
      validatedData.phoneNumber,
      savedFile.path,
      processedCaption
    );

    await storage.createSystemLog({
      level: 'info',
      message: 'File sent via external URL endpoint',
      service: 'whatsapp',
      metadata: {
        userId: validatedData.userId,
        sessionId: targetSession.id,
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
        messageId: messageResult.id,
        sessionId: targetSession.id,
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

export { router as externalApiRoutes };