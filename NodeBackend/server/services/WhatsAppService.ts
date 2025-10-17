import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  WASocket
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

export interface WhatsAppStatus {
  isConnected: boolean;
  isAuthenticated: boolean;
  lastSeen: Date | null;
  sessionInfo: any;
}

export class WhatsAppService extends EventEmitter {
  private socket: WASocket | null = null;
  private status: WhatsAppStatus = {
    isConnected: false,
    isAuthenticated: false,
    lastSeen: null,
    sessionInfo: null,
  };
  private authPath: string;
  private currentQR: string | null = null;

  constructor() {
    super();
    this.authPath = path.join(process.cwd(), 'server/sessions/baileys_auth');
    if (!fs.existsSync(this.authPath)) {
      fs.mkdirSync(this.authPath, { recursive: true });
    }
  }

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Starting Baileys WhatsApp - no Chrome needed!');
      
      const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
      const { version } = await fetchLatestBaileysVersion();

      this.socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ['LIMS System', 'Chrome', '1.0.0']
      });

      this.socket.ev.on('creds.update', saveCreds);

      this.socket.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log('📱 Baileys QR received!');
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qr)}`;
          this.currentQR = qrUrl;
          this.emit('qr-code', { qr: qrUrl, rawQR: qr });
          console.log('🎯 Baileys QR emitted to frontend');
        }

        if (connection === 'open') {
          console.log('✅ Connected via Baileys!');
          this.status.isConnected = true;
          this.status.isAuthenticated = true;
          this.status.lastSeen = new Date();
          this.currentQR = null;
          this.emit('whatsapp-authenticated', { status: this.status });
        } else if (connection === 'close') {
          console.log('❌ Baileys connection closed');
          this.status.isConnected = false;
          this.status.isAuthenticated = false;
          
          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            console.log('🔄 Reconnecting in 5 seconds...');
            setTimeout(() => this.initialize(), 5000);
          } else {
            console.log('🚪 Logged out - need new QR scan');
            this.emit('whatsapp-auth-failure', { error: 'Logged out' });
          }
        }
      });

    } catch (error: any) {
      console.error('❌ Baileys init failed:', error);
      this.emit('whatsapp-auth-failure', { error: error?.message });
    }
  }

  async sendTextMessage(phoneNumber: string, message: string): Promise<any> {
    if (!this.socket || !this.status.isConnected) {
      throw new Error('WhatsApp not connected');
    }

    const jid = `${this.formatPhoneNumber(phoneNumber)}@s.whatsapp.net`;
    const result = await this.socket.sendMessage(jid, { text: message });
    
    this.status.lastSeen = new Date();
    this.emit('message-sent', {
      messageId: result?.key?.id,
      to: jid,
      timestamp: Date.now(),
    });
    
    return {
      id: result?.key?.id,
      to: jid,
      body: message,
      timestamp: Date.now(),
    };
  }

  async sendMediaMessage(phoneNumber: string, filePath: string, caption?: string): Promise<any> {
    if (!this.socket || !this.status.isConnected) {
      throw new Error('WhatsApp not connected');
    }

    const jid = `${this.formatPhoneNumber(phoneNumber)}@s.whatsapp.net`;
    const fileBuffer = fs.readFileSync(filePath);
    const fileExtension = path.extname(filePath).toLowerCase();
    
    let messageContent: any = {};
    
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(fileExtension)) {
      messageContent = { image: fileBuffer, caption: caption };
    } else if (['.pdf', '.doc', '.docx', '.txt'].includes(fileExtension)) {
      messageContent = { document: fileBuffer, fileName: path.basename(filePath), caption: caption };
    } else {
      messageContent = { document: fileBuffer, fileName: path.basename(filePath), caption: caption };
    }
    
    const result = await this.socket.sendMessage(jid, messageContent);
    
    this.status.lastSeen = new Date();
    this.emit('message-sent', {
      messageId: result?.key?.id,
      to: jid,
      timestamp: Date.now(),
    });
    
    return {
      id: result?.key?.id,
      to: jid,
      hasMedia: true,
      caption: caption,
      timestamp: Date.now(),
    };
  }

  async generateQRCode(): Promise<void> {
    console.log('🔄 QR generation requested');
    
    if (this.status.isConnected) {
      throw new Error('WhatsApp is already connected');
    }
    
    if (this.currentQR) {
      console.log('✅ QR already available, emitting existing QR');
      this.emit('qr-code', { qr: this.currentQR, rawQR: this.currentQR });
      return;
    }
    
    console.log('🔄 No current QR, initializing connection...');
    await this.initialize();
  }

  getCurrentQR(): string | null {
    return this.currentQR;
  }

  getStatus(): WhatsAppStatus {
    return { ...this.status };
  }

  private formatPhoneNumber(phoneNumber: string): string {
    let cleaned = phoneNumber.replace(/\D/g, '');
    if (!cleaned.startsWith('1') && cleaned.length === 10) {
      cleaned = '1' + cleaned;
    }
    return cleaned;
  }

  async cleanup(): Promise<void> {
    if (this.socket) {
      console.log('🧹 Cleaning up Baileys connection...');
      this.socket.end(undefined);
      this.socket = null;
    }
    
    this.status = {
      isConnected: false,
      isAuthenticated: false,
      lastSeen: null,
      sessionInfo: null,
    };
    
    this.currentQR = null;
  }
}

export const whatsAppService = new WhatsAppService();