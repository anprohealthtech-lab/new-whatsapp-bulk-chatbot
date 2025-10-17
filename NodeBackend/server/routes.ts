import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import multer from "multer";
import cors from "cors";
import { storage } from "./storage";
import { whatsAppService } from "./services/WhatsAppService";
import { messageService } from "./services/MessageService";
import { fileService } from "./services/FileService";
import { persistentFileService } from "./services/PersistentFileService";
import { sendMessageSchema, sendReportSchema } from "@shared/schema";
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

  // Initialize WhatsApp service
  try {
    await whatsAppService.initialize();
    log("WhatsApp service initialized successfully");
  } catch (error) {
    log(`Failed to initialize WhatsApp service: ${error.message}`);
  }

  // Create HTTP server
  const httpServer = createServer(app);

  // Setup WebSocket server for real-time communication
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // WebSocket connection handling
  wss.on('connection', (ws) => {
    log('WebSocket client connected');

    // Send current WhatsApp status
    const status = whatsAppService.getStatus();
    ws.send(JSON.stringify({
      type: 'whatsapp-status',
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

  // Setup WhatsApp service event listeners with reconnection handling
  const setupWhatsAppEventListeners = () => {
    // Don't remove all listeners as it breaks ongoing QR code broadcasting
    // Only set up listeners if they don't exist already
    
    whatsAppService.on('qr-code', (data) => {
      console.log('🎯 ROUTES: Received qr-code event from WhatsApp service');
      console.log('🎯 QR Data received:', data);
      console.log('🎯 WebSocket clients count:', wss.clients.size);
      console.log('🎯 Broadcasting QR code to WebSocket clients...');
      broadcast('qr-code', data);
      console.log('🎯 QR code broadcast completed');
    });

    whatsAppService.on('whatsapp-status', (data) => {
      broadcast('whatsapp-status', data);
    });

    whatsAppService.on('whatsapp-authenticated', (data) => {
      broadcast('whatsapp-authenticated', data);
    });

    whatsAppService.on('whatsapp-auth-failure', (data) => {
      broadcast('whatsapp-auth-failure', data);
    });

    whatsAppService.on('disconnected', (data) => {
      broadcast('disconnected', data);
    });

    whatsAppService.on('message-sent', (data) => {
      broadcast('message-sent', data);
    });

    whatsAppService.on('message-update', async (data) => {
      // Update message delivery status
      await messageService.updateMessageDeliveryStatus(data.messageId, data.ack === 3 ? 'delivered' : 'failed');
      broadcast('message-update', data);
    });
  };
  
  setupWhatsAppEventListeners();

  // API Routes

  // Send text message
  app.post('/api/send-message', async (req, res) => {
    try {
      const validatedData = sendMessageSchema.parse(req.body);
      const message = await messageService.sendTextMessage(
        validatedData.phoneNumber,
        validatedData.content
      );

      res.json({ success: true, message });
    } catch (error) {
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
      const whatsappStatus = whatsAppService.getStatus();
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
    } catch (error) {
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

  // Generate QR code endpoint
  app.post('/api/generate-qr', async (req: Request, res: Response) => {
    try {
      log('Generate QR code request received');
      await whatsAppService.generateQRCode();
      res.json({ success: true, message: 'QR code generation started' });
    } catch (error: any) {
      log(`Generate QR error: ${error.message}`);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to generate QR code'
      });
    }
  });

  // Get current QR code endpoint (fallback for when WebSocket fails)
  app.get('/api/qr-code', (req: Request, res: Response) => {
    try {
      // Return the last generated QR code
      const currentQR = whatsAppService.getCurrentQR();
      if (currentQR) {
        res.json({ 
          success: true, 
          data: { 
            qr: currentQR.qr, 
            generated: currentQR.timestamp,
            message: 'QR code available for scanning'
          } 
        });
      } else {
        res.json({ 
          success: false, 
          message: 'No QR code available. WhatsApp service initializing...' 
        });
      }
    } catch (error: any) {
      log(`Get QR error: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get QR code'
      });
    }
  });

  // WhatsApp API endpoints
  app.get('/api/whatsapp/status', async (req, res) => {
    try {
      const status = whatsAppService.getStatus();
      res.json({ 
        success: true, 
        data: status
      });
    } catch (error) {
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
      // Re-setup event listeners before connecting
      setupWhatsAppEventListeners();
      
      const result = await whatsAppService.initialize();
      res.json({ 
        success: true, 
        message: 'WhatsApp connection initiated'
      });
    } catch (error) {
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
      await whatsAppService.disconnect();
      res.json({ 
        success: true, 
        message: 'WhatsApp disconnected successfully'
      });
    } catch (error) {
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
      // For now, return a placeholder since qrCode isn't in the status type
      // The QR code will be handled via WebSocket events
      res.json({ 
        success: false, 
        error: 'QR code available via WebSocket events only. Use /api/generate-qr endpoint.' 
      });
    } catch (error) {
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

  // Cleanup old files periodically
  setInterval(async () => {
    await fileService.cleanupOldFiles(24); // Clean files older than 24 hours
  }, 60 * 60 * 1000); // Run every hour

  return httpServer;
}
