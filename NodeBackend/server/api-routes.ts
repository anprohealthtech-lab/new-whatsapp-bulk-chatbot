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
      email: validatedData.userInfo.email,
      role: validatedData.userInfo.role,
      organizationId: validatedData.organizationId,
      isExternal: true,
    });
    
    // Store organization info if provided
    if (validatedData.userInfo.organizationName) {
      await storage.syncExternalOrganization({
        id: validatedData.organizationId,
        name: validatedData.userInfo.organizationName,
        isExternal: true,
      });
    }
    
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
    
    await storage.syncExternalUser(validatedData);
    
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