import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { multiWhatsAppService } from './services/MultiWhatsAppService.js';
import { messageService } from './services/MessageService.js';
import { fileService } from './services/FileService.js';
import { storage } from './storage.js';
import { createServer } from 'http';
import { Server } from 'socket.io';

const router = express.Router();

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB default
    files: 1,
  },
});

// JWT middleware for authentication
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Validation schemas
const sendMessageSchema = z.object({
  phoneNumber: z.string().min(10, 'Phone number must be at least 10 digits'),
  content: z.string().min(1, 'Message content is required'),
  sessionId: z.string().optional(),
});

const sendReportSchema = z.object({
  phoneNumber: z.string().min(10, 'Phone number must be at least 10 digits'),
  message: z.string().optional(),
  sampleId: z.string().min(1, 'Sample ID is required'),
  patientName: z.string().optional(),
  doctorName: z.string().optional(),
  labName: z.string().optional(),
  reportDate: z.string().optional(),
  sessionId: z.string().optional(),
});

const userRegistrationSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  organizationId: z.string().optional(),
  role: z.enum(['admin', 'manager', 'user']).default('user'),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const sessionCreateSchema = z.object({
  strategyName: z.enum(['business_hours', 'always_on', 'on_demand']).default('business_hours'),
});

// ========================================
// Authentication Routes
// ========================================

// User registration
router.post('/auth/register', async (req, res) => {
  try {
    const validatedData = userRegistrationSchema.parse(req.body);
    
    // Check if user already exists
    const existingUser = await storage.getUserByUsername(validatedData.username);
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username already exists' 
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(validatedData.password, 10);
    
    // Create user
    const userId = uuidv4();
    const user = await storage.createUser({
      id: userId,
      username: validatedData.username,
      email: validatedData.email,
      passwordHash,
      organizationId: validatedData.organizationId,
      role: validatedData.role,
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Registration failed',
      error: error.message,
    });
  }
});

// User login
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    
    const user = await storage.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Update last login
    await storage.updateUserLastLogin(user.id);

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        role: user.role,
        organizationId: user.organizationId 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
        },
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Login failed',
      error: error.message,
    });
  }
});

// ========================================
// WhatsApp Session Management Routes
// ========================================

// Create new WhatsApp session for user
router.post('/sessions/create', authenticateToken, async (req, res) => {
  try {
    const { strategyName } = sessionCreateSchema.parse(req.body);
    const userId = req.user.userId;

    const { sessionId, qrCode } = await multiWhatsAppService.createUserSession(userId, strategyName);

    res.json({
      success: true,
      message: 'Session created successfully',
      data: { sessionId, qrCode },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Session creation failed',
      error: error.message,
    });
  }
});

// Get user's active sessions
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const sessions = multiWhatsAppService.getUserActiveSessions(userId);

    res.json({
      success: true,
      data: { sessions },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to get sessions',
      error: error.message,
    });
  }
});

// Get specific session details
router.get('/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.userId;
    
    const session = multiWhatsAppService.getSession(sessionId);
    if (!session || session.userId !== userId) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or access denied',
      });
    }

    res.json({
      success: true,
      data: { session },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to get session',
      error: error.message,
    });
  }
});

// Disconnect specific session
router.delete('/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.userId;
    
    const session = multiWhatsAppService.getSession(sessionId);
    if (!session || session.userId !== userId) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or access denied',
      });
    }

    await multiWhatsAppService.disconnectSession(sessionId);

    res.json({
      success: true,
      message: 'Session disconnected successfully',
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Failed to disconnect session',
      error: error.message,
    });
  }
});

// ========================================
// Message Sending Routes
// ========================================

// Send text message (multi-session aware)
router.post('/messages/send', authenticateToken, async (req, res) => {
  try {
    const { phoneNumber, content, sessionId } = sendMessageSchema.parse(req.body);
    const userId = req.user.userId;

    let targetSessionId = sessionId;
    
    // If no specific session provided, use the first active session
    if (!targetSessionId) {
      const activeSessions = multiWhatsAppService.getUserActiveSessions(userId);
      if (activeSessions.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No active WhatsApp sessions. Please connect first.',
        });
      }
      targetSessionId = activeSessions[0].id;
    }

    // Verify session belongs to user
    const session = multiWhatsAppService.getSession(targetSessionId);
    if (!session || session.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Session not found or access denied',
      });
    }

    const result = await multiWhatsAppService.sendMessage(targetSessionId, phoneNumber, content);

    // Log message to database
    const messageId = uuidv4();
    await storage.createMessage({
      id: messageId,
      userId,
      sessionId: targetSessionId,
      phoneNumber,
      content,
      type: 'text',
      status: 'sent',
      metadata: JSON.stringify({
        whatsappId: result.id,
        whatsappTimestamp: result.timestamp,
      }),
      sentAt: new Date(),
    });

    res.json({
      success: true,
      message: 'Message sent successfully',
      data: {
        messageId,
        whatsappId: result.id,
        to: phoneNumber,
        content,
        sessionId: targetSessionId,
        timestamp: result.timestamp,
      },
    });
  } catch (error: any) {
    console.error('Send message error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to send message',
      error: error.message,
    });
  }
});

// Send report with attachment (multi-session aware)
router.post('/messages/send-report', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { phoneNumber, message, sampleId, patientName, doctorName, labName, reportDate, sessionId } = 
      sendReportSchema.parse(req.body);
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'File attachment is required',
      });
    }

    let targetSessionId = sessionId;
    
    // If no specific session provided, use the first active session
    if (!targetSessionId) {
      const activeSessions = multiWhatsAppService.getUserActiveSessions(userId);
      if (activeSessions.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No active WhatsApp sessions. Please connect first.',
        });
      }
      targetSessionId = activeSessions[0].id;
    }

    // Verify session belongs to user
    const session = multiWhatsAppService.getSession(targetSessionId);
    if (!session || session.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Session not found or access denied',
      });
    }

    // Process file upload
    const { filePath, fileName } = await fileService.saveUploadedFile(req.file);

    // Send message with attachment
    const caption = message || `Lab report for sample ${sampleId}`;
    const result = await multiWhatsAppService.sendMediaMessage(targetSessionId, phoneNumber, filePath, caption);

    // Log message to database
    const messageId = uuidv4();
    await storage.createMessage({
      id: messageId,
      userId,
      sessionId: targetSessionId,
      phoneNumber,
      content: caption,
      type: 'report',
      status: 'sent',
      fileUrl: `/uploads/${fileName}`,
      fileName,
      fileSize: req.file.size,
      sampleId,
      patientName,
      doctorName,
      labName,
      reportDate,
      metadata: JSON.stringify({
        whatsappId: result.id,
        whatsappTimestamp: result.timestamp,
      }),
      sentAt: new Date(),
    });

    res.json({
      success: true,
      message: 'Report sent successfully',
      data: {
        messageId,
        whatsappId: result.id,
        to: phoneNumber,
        sampleId,
        fileUrl: `/uploads/${fileName}`,
        fileName,
        fileSize: req.file.size,
        sessionId: targetSessionId,
        timestamp: result.timestamp,
      },
    });
  } catch (error: any) {
    console.error('Send report error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to send report',
      error: error.message,
    });
  }
});

// ========================================
// Message History Routes
// ========================================

// Get user's message history
router.get('/messages', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 50, offset = 0, status, type, sessionId } = req.query;

    const messages = await storage.getUserMessages(userId, {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      status: status as string,
      type: type as string,
      sessionId: sessionId as string,
    });

    const totalCount = await storage.getUserMessageCount(userId);

    res.json({
      success: true,
      data: {
        messages,
        pagination: {
          total: totalCount,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      error: error.message,
    });
  }
});

// ========================================
// Admin Routes (admin role required)
// ========================================

const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required',
    });
  }
  next();
};

// Get system status (admin only)
router.get('/admin/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const systemStatus = multiWhatsAppService.getSystemStatus();
    const allSessions = multiWhatsAppService.getAllSessions();
    
    res.json({
      success: true,
      data: {
        system: systemStatus,
        sessions: allSessions,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to get system status',
      error: error.message,
    });
  }
});

// Get all users (admin only)
router.get('/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await storage.getAllUsers();
    
    res.json({
      success: true,
      data: { users },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to get users',
      error: error.message,
    });
  }
});

// Disconnect all sessions for a user (admin only)
router.delete('/admin/users/:userId/sessions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const userSessions = multiWhatsAppService.getUserActiveSessions(userId);
    const disconnectPromises = userSessions.map(session => 
      multiWhatsAppService.disconnectSession(session.id)
    );
    
    await Promise.all(disconnectPromises);

    res.json({
      success: true,
      message: `Disconnected ${userSessions.length} sessions for user ${userId}`,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Failed to disconnect user sessions',
      error: error.message,
    });
  }
});

// ========================================
// Legacy Routes (for backward compatibility)
// ========================================

// Legacy health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Multi-Session WhatsApp LIMS Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Legacy status endpoint
router.get('/status', async (req, res) => {
  try {
    const systemStatus = multiWhatsAppService.getSystemStatus();
    
    res.json({
      success: true,
      data: {
        whatsapp: {
          totalSessions: systemStatus.totalSessions,
          activeSessions: systemStatus.activeSessions,
          authenticatedSessions: systemStatus.authenticatedSessions,
        },
        stats: {
          totalSessions: systemStatus.totalSessions,
          uptime: systemStatus.uptime,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to get status',
      error: error.message,
    });
  }
});

// Legacy single-session message sending (uses first available session)
router.post('/send-message', async (req, res) => {
  try {
    const { phoneNumber, content } = sendMessageSchema.parse(req.body);
    
    // For legacy support, we need a default user - in production, this should require auth
    const allSessions = multiWhatsAppService.getAllSessions();
    const authenticatedSession = allSessions.find(s => s.isAuthenticated);
    
    if (!authenticatedSession) {
      return res.status(400).json({
        success: false,
        message: 'No authenticated WhatsApp sessions available',
      });
    }

    const result = await multiWhatsAppService.sendMessage(authenticatedSession.id, phoneNumber, content);

    res.json({
      success: true,
      message: 'Message sent successfully',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Failed to send message',
      error: error.message,
    });
  }
});

// ========================================
// User-Specific WhatsApp File Upload Endpoints
// ========================================

// Helper function for template processing
function processMessageTemplate(template: string, data: any): string {
  let processed = template;
  
  Object.entries(data).forEach(([key, value]) => {
    if (value) {
      const placeholder = `[${key.charAt(0).toUpperCase() + key.slice(1)}]`;
      processed = processed.replace(new RegExp(placeholder, 'g'), value as string);
    }
  });
  
  return processed;
}

// Document/File Upload Endpoint - FIXES 404 ERROR
router.post('/users/:userId/whatsapp/send-document', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { to, caption, patientName, testName, doctorName } = req.body;
    const file = req.file;

    // Validate required fields
    if (!file || !to) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: file and to number are required'
      });
    }

    // Validate phone number format
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(to)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use E.164 format: +countrycode+number'
      });
    }

    // Save uploaded file
    const savedFile = await fileService.saveFile(file);
    
    // Process message template if caption provided
    let processedCaption = caption || '';
    if (caption && (patientName || testName || doctorName)) {
      processedCaption = processMessageTemplate(caption, {
        patientName,
        testName,
        doctorName,
        reportDate: new Date().toLocaleDateString()
      });
    }

    // Send document via WhatsApp
    const result = await multiWhatsAppService.sendMediaMessage(
      userId,
      to,
      savedFile.filePath,
      processedCaption
    );

    if (result.success) {
      // Log successful send
      await storage.createSystemLog({
        level: 'info',
        message: `Document sent successfully to ${to}`,
        metadata: { userId, fileName: savedFile.fileName, fileSize: savedFile.size }
      });
      
      res.json({
        success: true,
        messageId: result.messageId,
        message: 'Document sent successfully',
        fileName: savedFile.fileName
      });
    } else {
      // Log failure
      await storage.createSystemLog({
        level: 'error',
        message: `Failed to send document to ${to}: ${result.error}`,
        metadata: { userId, fileName: savedFile.fileName }
      });
      
      res.status(400).json({
        success: false,
        message: result.error || 'Failed to send document'
      });
    }

  } catch (error: any) {
    console.error('Send document error:', error);
    await storage.createSystemLog({
      level: 'error',
      message: `Document send error: ${error.message}`,
      metadata: { userId: req.params.userId, error: error.message }
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to send document',
      error: error.message
    });
  }
});

// File URL Endpoint - FIXES 404 ERROR (for sending files from URLs)
router.post('/users/:userId/whatsapp/send-file-url', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { to, fileUrl, caption, fileName, patientName, testName, doctorName } = req.body;

    // Validate required fields
    if (!fileUrl || !to) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: fileUrl and to number are required'
      });
    }

    // Validate phone number format
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(to)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use E.164 format: +countrycode+number'
      });
    }

    // Download and save file from URL
    const savedFile = await fileService.downloadAndSaveFile(fileUrl, userId, fileName);
    
    // Process message template if caption provided
    let processedCaption = caption || '';
    if (caption && (patientName || testName || doctorName)) {
      processedCaption = processMessageTemplate(caption, {
        patientName,
        testName,
        doctorName,
        reportDate: new Date().toLocaleDateString()
      });
    }

    // Send document via WhatsApp
    const result = await multiWhatsAppService.sendMediaMessage(
      userId,
      to,
      savedFile.path,
      processedCaption
    );

    if (result.success) {
      // Log successful send
      await storage.createSystemLog({
        level: 'info',
        message: `File from URL sent successfully to ${to}`,
        metadata: { userId, sourceUrl: fileUrl, fileName: savedFile.name, fileSize: savedFile.size }
      });
      
      res.json({
        success: true,
        messageId: result.messageId,
        message: 'File from URL sent successfully',
        fileName: savedFile.name
      });
    } else {
      // Log failure
      await storage.createSystemLog({
        level: 'error',
        message: `Failed to send file from URL to ${to}: ${result.error}`,
        metadata: { userId, sourceUrl: fileUrl, fileName: savedFile.name }
      });
      
      res.status(400).json({
        success: false,
        message: result.error || 'Failed to send file'
      });
    }

  } catch (error: any) {
    console.error('Send file URL error:', error);
    await storage.createSystemLog({
      level: 'error',
      message: `File URL send error: ${error.message}`,
      metadata: { userId: req.params.userId, fileUrl: req.body.fileUrl, error: error.message }
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to send file from URL',
      error: error.message
    });
  }
});

// Image Upload Endpoint
router.post('/users/:userId/whatsapp/send-image', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { to, caption, patientName, testName, doctorName } = req.body;
    const file = req.file;

    // Validate required fields
    if (!file || !to) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: file and to number are required'
      });
    }

    // Validate it's an image
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: 'File must be an image (JPG, PNG, etc.)'
      });
    }

    // Validate phone number format
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(to)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use E.164 format: +countrycode+number'
      });
    }

    // Save uploaded image
    const savedFile = await fileService.saveFile(file);
    
    // Process message template if caption provided
    let processedCaption = caption || '';
    if (caption && (patientName || testName || doctorName)) {
      processedCaption = processMessageTemplate(caption, {
        patientName,
        testName,
        doctorName,
        reportDate: new Date().toLocaleDateString()
      });
    }

    // Send image via WhatsApp
    const result = await multiWhatsAppService.sendMediaMessage(
      userId,
      to,
      savedFile.filePath,
      processedCaption
    );

    if (result.success) {
      // Log successful send
      await storage.createSystemLog({
        level: 'info',
        message: `Image sent successfully to ${to}`,
        metadata: { userId, fileName: savedFile.fileName, fileSize: savedFile.size }
      });
      
      res.json({
        success: true,
        messageId: result.messageId,
        message: 'Image sent successfully',
        fileName: savedFile.fileName
      });
    } else {
      // Log failure
      await storage.createSystemLog({
        level: 'error',
        message: `Failed to send image to ${to}: ${result.error}`,
        metadata: { userId, fileName: savedFile.fileName }
      });
      
      res.status(400).json({
        success: false,
        message: result.error || 'Failed to send image'
      });
    }

  } catch (error: any) {
    console.error('Send image error:', error);
    await storage.createSystemLog({
      level: 'error',
      message: `Image send error: ${error.message}`,
      metadata: { userId: req.params.userId, error: error.message }
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to send image',
      error: error.message
    });
  }
});

// Text Message Endpoint for users
router.post('/users/:userId/whatsapp/send-message', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { to, message, patientName, testName, doctorName } = req.body;

    // Validate required fields
    if (!message || !to) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: message and to number are required'
      });
    }

    // Validate phone number format
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(to)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use E.164 format: +countrycode+number'
      });
    }

    // Process message template
    let processedMessage = message;
    if (patientName || testName || doctorName) {
      processedMessage = processMessageTemplate(message, {
        patientName,
        testName,
        doctorName,
        reportDate: new Date().toLocaleDateString()
      });
    }

    // Send text message via WhatsApp
    const result = await multiWhatsAppService.sendMessage(
      userId,
      to,
      processedMessage
    );

    if (result.success) {
      // Log successful send
      await storage.createSystemLog({
        level: 'info',
        message: `Text message sent successfully to ${to}`,
        metadata: { userId, messageLength: processedMessage.length }
      });
      
      res.json({
        success: true,
        messageId: result.messageId,
        message: 'Text message sent successfully'
      });
    } else {
      // Log failure
      await storage.createSystemLog({
        level: 'error',
        message: `Failed to send text message to ${to}: ${result.error}`,
        metadata: { userId }
      });
      
      res.status(400).json({
        success: false,
        message: result.error || 'Failed to send message'
      });
    }

  } catch (error: any) {
    console.error('Send message error:', error);
    await storage.createSystemLog({
      level: 'error',
      message: `Text message send error: ${error.message}`,
      metadata: { userId: req.params.userId, error: error.message }
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to send text message',
      error: error.message
    });
  }
});

// ========================================
// WebSocket Setup
// ========================================

export function setupWebSocket(server: any) {
  const io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173', 'http://localhost:3000'],
      credentials: true,
    },
  });

  // Multi-session event forwarding
  multiWhatsAppService.on('session-created', (data) => {
    io.emit('session-created', data);
  });

  multiWhatsAppService.on('session-connected', (data) => {
    io.emit('session-connected', data);
  });

  multiWhatsAppService.on('session-disconnected', (data) => {
    io.emit('session-disconnected', data);
  });

  multiWhatsAppService.on('qr-code', (data) => {
    io.emit('qr-code', data);
  });

  multiWhatsAppService.on('message-sent', (data) => {
    io.emit('message-sent', data);
  });

  io.on('connection', (socket) => {
    console.log('🔌 Client connected to multi-session WebSocket');
    
    socket.on('disconnect', () => {
      console.log('🔌 Client disconnected from multi-session WebSocket');
    });
  });

  return io;
}

export default router;