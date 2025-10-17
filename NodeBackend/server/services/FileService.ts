import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface FileInfo {
  originalName: string;
  fileName: string;
  filePath: string;
  size: number;
  mimeType: string;
}

export class FileService {
  private uploadsDir: string;
  private maxFileSize: number;
  private allowedTypes: string[];

  constructor() {
    this.uploadsDir = path.join(process.cwd(), 'uploads');
    this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '10485760'); // 10MB default
    this.allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'pdf,jpg,jpeg,png').split(',');
    
    // Ensure uploads directory exists
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  validateFile(file: { originalname: string; size: number; mimetype: string; buffer: Buffer }): void {
    // Check file size
    if (file.size > this.maxFileSize) {
      throw new Error(`File size exceeds maximum allowed size of ${this.maxFileSize / 1024 / 1024}MB`);
    }

    // Check file type
    const fileExtension = path.extname(file.originalname).toLowerCase().slice(1);
    if (!this.allowedTypes.includes(fileExtension)) {
      throw new Error(`File type not allowed. Allowed types: ${this.allowedTypes.join(', ')}`);
    }

    // Additional MIME type validation
    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new Error(`Invalid file format. Allowed formats: PDF, JPG, PNG`);
    }
  }

  async saveFile(file: { originalname: string; size: number; mimetype: string; buffer: Buffer }): Promise<FileInfo> {
    this.validateFile(file);

    const fileExtension = path.extname(file.originalname);
    const fileName = `${randomUUID()}${fileExtension}`;
    const filePath = path.join(this.uploadsDir, fileName);

    try {
      // Write file to disk
      await fs.promises.writeFile(filePath, file.buffer);

      return {
        originalName: file.originalname,
        fileName,
        filePath,
        size: file.size,
        mimeType: file.mimetype,
      };
    } catch (error) {
      console.error('Failed to save file:', error);
      throw new Error('Failed to save file to disk');
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
      // Don't throw error for cleanup operations
    }
  }

  async cleanupOldFiles(olderThanHours = 24): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.uploadsDir);
      const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);

      for (const file of files) {
        const filePath = path.join(this.uploadsDir, file);
        const stats = await fs.promises.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await this.deleteFile(filePath);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old files:', error);
    }
  }

  getUploadsDirectory(): string {
    return this.uploadsDir;
  }
}

export const fileService = new FileService();
