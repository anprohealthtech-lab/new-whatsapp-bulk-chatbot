import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import multer from "multer";
import cors from "cors";
import { storage } from "./storage";
import { multiUserWhatsAppService } from "./services/MultiUserWhatsAppService";
import { messageService } from "./services/MessageService";
import { fileService } from "./services/FileService";
import { persistentFileService } from "./services/PersistentFileService";
import { sendMessageSchema, sendReportSchema } from "@shared/schema";
import { externalApiRoutes } from "./api-routes";
import { log } from "./utils";

// Configure CORS
const corsOptions = {
  origin: [
    "http://localhost:4173",
    "http://localhost:5173",
    ...(process.env.REPLIT_DOMAINS ? process.env.REPLIT_DOMAINS.split(',') : [])
  ],
  credentials: true,
};

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB default
  },
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply CORS middleware
  app.use(cors(corsOptions));

  // Initialize Multi-User WhatsApp service
  try {
    await multiUserWhatsAppService.initialize();
    log("Multi-User WhatsApp service initialized successfully");
  } catch (error: any) {
    log(`Failed to initialize Multi-User WhatsApp service: ${error.message}`);
  }

  // Create HTTP server
  const httpServer = createServer(app);

  // Setup WebSocket server for real-time communication
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // WebSocket connection handling
  wss.on('connection', (ws) => {
    log('WebSocket client connected');

    // Send current Multi-User WhatsApp service status
    const status = multiUserWhatsAppService.getStats();
    ws.send(JSON.stringify({
      type: 'multi-user-status',
      data: status,
    }));

    ws.on('close', () => {
      log('WebSocket client disconnected');
    });

    ws.on('error', (error) => {
      log(`WebSocket error: ${error.message}`);
    });
  });

  // Broadcast function for WebSocket messages
  const broadcast = (type: string, data: any) => {
    const message = JSON.stringify({ type, data });
    console.log(`Broadcasting ${type} to ${wss.clients.size} clients:`, data);
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    });
  };

  // Setup Multi-User WhatsApp service event listeners
  const setupWhatsAppEventListeners = () => {
    
    multiUserWhatsAppService.on('user-qr-code', (data) => {
      console.log('🎯 ROUTES: Received user-qr-code event from Multi-User WhatsApp service');
      console.log('🎯 QR Data received:', data);
      console.log('🎯 WebSocket clients count:', wss.clients.size);
      console.log('🎯 Broadcasting QR code to WebSocket clients...');
      broadcast('user-qr-code', data);
      console.log('🎯 QR code broadcast completed');
    });

    multiUserWhatsAppService.on('user-status-update', (data) => {
      broadcast('user-status-update', data);
    });

    multiUserWhatsAppService.on('user-authenticated', (data) => {
      broadcast('user-authenticated', data);
    });

    multiUserWhatsAppService.on('user-auth-failure', (data) => {
      broadcast('user-auth-failure', data);
    });

    multiUserWhatsAppService.on('user-disconnected', (data) => {
      broadcast('user-disconnected', data);
    });

    multiUserWhatsAppService.on('user-message-sent', (data) => {
      broadcast('user-message-sent', data);
    });

    multiUserWhatsAppService.on('user-message-update', async (data) => {
      // Update message delivery status
      await messageService.updateMessageDeliveryStatus(data.messageId, data.ack === 3 ? 'delivered' : 'failed');
      broadcast('user-message-update', data);
    });
  };
  
  setupWhatsAppEventListeners();

  // API Routes

  // Send text message (DEPRECATED - Use user-specific endpoints)
  app.post('/api/send-message', async (req, res) => {
    try {
      res.status(400).json({ 
        success: false, 
        error: 'This endpoint is deprecated. Use /api/users/{userId}/whatsapp/send-message instead.',
        migration: {
          newEndpoint: 'POST /api/users/{userId}/whatsapp/send-message',
          description: 'Each user now has their own WhatsApp session for sending messages'
        }
      });
    } catch (error: any) {
      log(`Send message error: ${error.message}`);
      res.status(400).json({ 
        success: false, 
        error: error.message || 'Failed to send message' 
      });
    }
  });

  // Send report with file attachment
  app.post('/api/send-report', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file provided'
        });
      }

      const validatedData = sendReportSchema.parse(req.body);
      
      // Save uploaded file with persistent storage for deployment
      const fileInfo = process.env.DATABASE_URL 
        ? await persistentFileService.saveFile(req.file)
        : await fileService.saveFile(req.file);
      
      try {
        // Send report message
        const message = await messageService.sendReportMessage(
          validatedData.phoneNumber,
          fileInfo.filePath,
          fileInfo.fileName,
          fileInfo.size,
          validatedData.sampleId,
          validatedData.content
        );

        // Schedule file cleanup after successful send
        setTimeout(async () => {
          await fileService.deleteFile(fileInfo.filePath);
        }, 5 * 60 * 1000); // Delete after 5 minutes

        res.json({ success: true, message });
      } catch (sendError) {
        // Clean up file if sending failed
        await fileService.deleteFile(fileInfo.filePath);
        throw sendError;
      }
    } catch (error) {
      log(`Send report error: ${error.message}`);
      res.status(400).json({ 
        success: false, 
        error: error.message || 'Failed to send report' 
      });
    }
  });

  // Health check endpoint for DigitalOcean
  app.get('/api/health', (req, res) => {
    res.status(200).json({ 
      success: true, 
      message: 'Server is running',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // Get system status
  app.get('/api/status', async (req, res) => {
    try {
      const whatsappStatus = multiUserWhatsAppService.getStats();
      const messageStats = await messageService.getMessageStats();
      const systemLogs = await storage.getSystemLogs(10);

      res.json({
        success: true,
        data: {
          whatsapp: whatsappStatus,
          stats: messageStats,
          systemLogs,
          timestamp: new Date().toISOString(),
        }
      });
    } catch (error: any) {
      log(`Status error: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get system status' 
      });
    }
  });

  // Get message history
  app.get('/api/messages', async (req, res) => {
    try {
      const { status, phoneNumber, type, limit = '50', offset = '0', search } = req.query;
      
      const filters: any = {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      };

      if (status && status !== 'all') filters.status = status;
      if (phoneNumber) filters.phoneNumber = phoneNumber;
      if (type) filters.type = type;

      const result = await messageService.getMessageHistory(filters);

      // Apply search filter if provided
      let { messages } = result;
      if (search && typeof search === 'string') {
        const searchLower = search.toLowerCase();
        messages = messages.filter(msg => 
          msg.content.toLowerCase().includes(searchLower) ||
          msg.phoneNumber.includes(search) ||
          (msg.sampleId && msg.sampleId.toLowerCase().includes(searchLower))
        );
      }

      res.json({
        success: true,
        data: {
          messages,
          total: result.total,
          limit: filters.limit,
          offset: filters.offset,
        }
      });
    } catch (error) {
      log(`Get messages error: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get message history' 
      });
    }
  });

  // Generate QR code endpoint (DEPRECATED - Use user-specific endpoints)
  app.post('/api/generate-qr', async (req: Request, res: Response) => {
    try {
      log('Generate QR code request received (DEPRECATED)');
      res.status(400).json({ 
        success: false, 
        error: 'This endpoint is deprecated. Use /api/users/{userId}/whatsapp/connect instead.',
        migration: {
          newEndpoint: 'POST /api/users/{userId}/whatsapp/connect',
          description: 'Each user now has their own WhatsApp session'
        }
      });
    } catch (error: any) {
      log(`Generate QR error: ${error.message}`);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to generate QR code'
      });
    }
  });

  // Get current QR code endpoint (DEPRECATED)
  app.get('/api/qr-code', (req: Request, res: Response) => {
    try {
      res.json({ 
        success: false, 
        error: 'This endpoint is deprecated. Use /api/users/{userId}/whatsapp/qr instead.',
        migration: {
          newEndpoint: 'GET /api/users/{userId}/whatsapp/qr',
          description: 'Each user now has their own WhatsApp session and QR code'
        }
      });
    } catch (error: any) {
      log(`Get QR error: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get QR code'
      });
    }
  });

  // WhatsApp API endpoints (DEPRECATED)
  app.get('/api/whatsapp/status', async (req, res) => {
    try {
      res.json({ 
        success: false, 
        error: 'This endpoint is deprecated. Use /api/users/{userId}/whatsapp/status instead.',
        migration: {
          newEndpoint: 'GET /api/users/{userId}/whatsapp/status',
          description: 'Each user now has their own WhatsApp session status'
        }
      });
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log(`WhatsApp status error: ${errorMessage}`);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get WhatsApp status' 
      });
    }
  });

  app.post('/api/whatsapp/connect', async (req, res) => {
    try {
      res.json({ 
        success: false, 
        error: 'This endpoint is deprecated. Use /api/users/{userId}/whatsapp/connect instead.',
        migration: {
          newEndpoint: 'POST /api/users/{userId}/whatsapp/connect',
          description: 'Each user now has their own WhatsApp session connection'
        }
      });
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log(`WhatsApp connect error: ${errorMessage}`);
      res.status(400).json({ 
        success: false, 
        error: errorMessage || 'Failed to connect to WhatsApp' 
      });
    }
  });

  app.post('/api/whatsapp/disconnect', async (req, res) => {
    try {
      res.json({ 
        success: false, 
        error: 'This endpoint is deprecated. Use /api/users/{userId}/whatsapp/disconnect instead.',
        migration: {
          newEndpoint: 'DELETE /api/users/{userId}/whatsapp/session',
          description: 'Each user now has their own WhatsApp session disconnection'
        }
      });
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log(`WhatsApp disconnect error: ${errorMessage}`);
      res.status(400).json({ 
        success: false, 
        error: errorMessage || 'Failed to disconnect from WhatsApp' 
      });
    }
  });

  app.get('/api/whatsapp/qr', async (req, res) => {
    try {
      res.json({ 
        success: false, 
        error: 'This endpoint is deprecated. Use /api/users/{userId}/whatsapp/qr instead.',
        migration: {
          newEndpoint: 'GET /api/users/{userId}/whatsapp/qr',
          description: 'Each user now has their own WhatsApp session and QR code'
        }
      });
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log(`WhatsApp QR error: ${errorMessage}`);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get QR code' 
      });
    }
  });

  // Resend failed message
  app.post('/api/messages/:id/resend', async (req, res) => {
    try {
      const { id } = req.params;
      const message = await messageService.resendMessage(id);
      
      res.json({ success: true, message });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log(`Resend message error: ${errorMessage}`);
      res.status(400).json({ 
        success: false, 
        error: errorMessage || 'Failed to resend message' 
      });
    }
  });

  // Get system logs
  app.get('/api/logs', async (req, res) => {
    try {
      const { limit = '50', offset = '0' } = req.query;
      const logs = await storage.getSystemLogs(
        parseInt(limit as string),
        parseInt(offset as string)
      );

      res.json({ success: true, data: logs });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log(`Get logs error: ${errorMessage}`);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get system logs' 
      });
    }
  });

  // =================== NEW MULTI-USER WHATSAPP API ENDPOINTS ===================
  
  // Get all users with their WhatsApp session status
  app.get('/api/users/whatsapp/summary', async (req, res) => {
    try {
      const summary = multiUserWhatsAppService.getStats();
      res.json({ success: true, data: summary });
    } catch (error: any) {
      log(`Get users summary error: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get users summary' 
      });
    }
  });

  // Connect a specific user to WhatsApp (generates QR if needed)
  app.post('/api/users/:userId/whatsapp/connect', async (req, res) => {
    try {
      const { userId } = req.params;
      
      // Validate user exists
      const users = await storage.getUsers();
      const user = users.find(u => u.id === userId);
      if (!user) {
        return res.status(404).json({ 
          success: false, 
          error: 'User not found' 
        });
      }

      const result = await multiUserWhatsAppService.createUserSession(userId);
      res.json({ 
        success: true, 
        data: result,
        message: `WhatsApp connection initiated for user ${user.name}` 
      });
    } catch (error: any) {
      log(`User WhatsApp connect error: ${error.message}`);
      res.status(400).json({ 
        success: false, 
        error: error.message || 'Failed to connect user to WhatsApp' 
      });
    }
  });

  // Get specific user's WhatsApp status
  app.get('/api/users/:userId/whatsapp/status', async (req, res) => {
    try {
      const { userId } = req.params;
      const sessions = multiUserWhatsAppService.getUserSessions(userId);
      res.json({ success: true, data: { sessions } });
    } catch (error: any) {
      log(`Get user status error: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get user WhatsApp status' 
      });
    }
  });

  // Get specific user's QR code
  app.get('/api/users/:userId/whatsapp/qr', async (req, res) => {
    try {
      const { userId } = req.params;
      // For now, return a message that QR codes are available via WebSocket events
      res.json({ 
        success: false, 
        error: 'QR codes are available via WebSocket events (user-qr-code). Create a session first with POST /api/users/:userId/whatsapp/connect' 
      });
    } catch (error: any) {
      log(`Get user QR error: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get user QR code' 
      });
    }
  });

  // Send message from specific user
  app.post('/api/users/:userId/whatsapp/send-message', async (req, res) => {
    try {
      const { userId } = req.params;
      const { phoneNumber, message } = req.body;

      if (!phoneNumber || !message) {
        return res.status(400).json({ 
          success: false, 
          error: 'Phone number and message are required' 
        });
      }

      const result = await multiUserWhatsAppService.sendMessageFromUser(userId, phoneNumber, message);
      res.json({ success: true, data: result });
    } catch (error: any) {
      log(`User send message error: ${error.message}`);
      res.status(400).json({ 
        success: false, 
        error: error.message || 'Failed to send message' 
      });
    }
  });

  // Refresh QR code for user (if experiencing timeout issues)
  app.post('/api/users/:userId/whatsapp/refresh-qr', async (req, res) => {
    try {
      const { userId } = req.params;
      
      // First try to get existing QR code
      const qrResult = await multiUserWhatsAppService.refreshQRCode(userId);
      
      if (qrResult.success && qrResult.qrCode) {
        return res.json({
          success: true,
          message: 'Existing QR code available',
          data: {
            qrCode: qrResult.qrCode,
            note: 'This is an existing QR code. Scan within 2 minutes.'
          }
        });
      }
      
      // If no existing QR, create fresh session with rate limiting protection
      await multiUserWhatsAppService.disconnectUser(userId);
      
      // Wait for cleanup and rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Create new session with fresh QR - this is a refresh, so bypass rate limiting
      const result = await multiUserWhatsAppService.createUserSession(userId, 'on_demand', true);
      
      if (result.success) {
        res.json({
          success: true,
          message: 'Fresh QR code generated. New connection initiated.',
          data: {
            sessionId: result.sessionId,
            qrCode: result.qrCode,
            note: 'New QR code generated. Please scan within 2 minutes.'
          }
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to generate fresh QR code',
          error: result.error
        });
      }
    } catch (error: any) {
      log(`Refresh QR error for user ${req.params.userId}: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to refresh QR code',
        error: error.message
      });
    }
  });

  // Disconnect specific user from WhatsApp
  app.delete('/api/users/:userId/whatsapp/session', async (req, res) => {
    try {
      const { userId } = req.params;
      await multiUserWhatsAppService.disconnectUser(userId);
      res.json({ 
        success: true, 
        message: 'User WhatsApp session disconnected successfully' 
      });
    } catch (error: any) {
      log(`User disconnect error: ${error.message}`);
      res.status(400).json({ 
        success: false, 
        error: error.message || 'Failed to disconnect user from WhatsApp' 
      });
    }
  });

  // Get all active WhatsApp sessions
  app.get('/api/admin/whatsapp/sessions', async (req, res) => {
    try {
      const sessions = multiUserWhatsAppService.getActiveUserSessions();
      res.json({ success: true, data: sessions });
    } catch (error: any) {
      log(`Get all sessions error: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get active sessions' 
      });
    }
  });

  // =================== END MULTI-USER WHATSAPP API ENDPOINTS ===================

  // External API routes for integration with other apps
  app.use('/api', externalApiRoutes);

  // ===========================================
  // ADMIN ENDPOINTS - Session Management
  // ===========================================

  // Get system session status for healthcare admins
  app.get('/api/admin/sessions/status', async (req, res) => {
    try {
      const summary = await multiUserWhatsAppService.getSystemSummary();
      const maxGlobal = parseInt(process.env.WHATSAPP_MAX_GLOBAL_SESSIONS || '25');
      const maxPerUser = parseInt(process.env.WHATSAPP_MAX_SESSIONS_PER_USER || '3');
      
      res.json({
        success: true,
        data: {
          globalSessions: {
            active: summary.totalSessions,
            connected: summary.connectedSessions,
            limit: maxGlobal,
            utilization: Math.round((summary.totalSessions / maxGlobal) * 100),
            availableSlots: maxGlobal - summary.totalSessions
          },
          userSessions: summary.userBreakdown.map((user: any) => ({
            userId: user.userId,
            userName: user.userName,
            activeSessions: user.sessionCount,
            connectedSessions: user.connectedCount,
            maxAllowed: maxPerUser,
            status: user.connectedCount > 0 ? 'connected' : 'disconnected',
            utilization: Math.round((user.sessionCount / maxPerUser) * 100)
          })),
          systemHealth: {
            uptime: Math.round(process.uptime()),
            memoryUsage: process.memoryUsage(),
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development'
          },
          configuration: {
            maxGlobalSessions: maxGlobal,
            maxSessionsPerUser: maxPerUser,
            cleanupInterval: parseInt(process.env.SESSION_CLEANUP_INTERVAL || '300000'),
            inactiveTimeout: parseInt(process.env.INACTIVE_SESSION_TIMEOUT || '300000'),
            qrTimeout: parseInt(process.env.WHATSAPP_QR_TIMEOUT || '60000')
          }
        }
      });
    } catch (error: any) {
      log(`Admin session status error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to get session status',
        error: error.message
      });
    }
  });

  // Force cleanup endpoint for admins
  app.post('/api/admin/sessions/cleanup', async (req, res) => {
    try {
      const { userId, force } = req.body;
      
      if (userId) {
        // Cleanup specific user sessions
        const user = await storage.getUser(userId);
        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }
        
        await multiUserWhatsAppService.disconnectUser(userId);
        log(`Admin cleanup: Disconnected all sessions for user ${user.name}`);
        
        res.json({
          success: true,
          message: `Cleaned up sessions for user ${user.name} (${userId})`
        });
      } else if (force) {
        // Force global cleanup of all inactive sessions
        const beforeCount = (await multiUserWhatsAppService.getSystemSummary()).totalSessions;
        await multiUserWhatsAppService.forceCleanupAllSessions();
        const afterCount = (await multiUserWhatsAppService.getSystemSummary()).totalSessions;
        
        log(`Admin force cleanup: ${beforeCount - afterCount} sessions removed`);
        
        res.json({
          success: true,
          message: `Force cleanup completed: ${beforeCount - afterCount} sessions removed`,
          beforeCount,
          afterCount
        });
      } else {
        // Standard cleanup
        const beforeCount = (await multiUserWhatsAppService.getSystemSummary()).totalSessions;
        // This would need to be implemented in the service
        await multiUserWhatsAppService.adminCleanupInactiveSessions();
        const afterCount = (await multiUserWhatsAppService.getSystemSummary()).totalSessions;
        
        log(`Admin cleanup: ${beforeCount - afterCount} inactive sessions removed`);
        
        res.json({
          success: true,
          message: `Cleanup completed: ${beforeCount - afterCount} inactive sessions removed`,
          beforeCount,
          afterCount
        });
      }
    } catch (error: any) {
      log(`Admin cleanup error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Cleanup failed',
        error: error.message
      });
    }
  });

  // Cleanup old files periodically
  setInterval(async () => {
    await fileService.cleanupOldFiles(24); // Clean files older than 24 hours
  }, 60 * 60 * 1000); // Run every hour

  return httpServer;
}
