import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import fetch from 'node-fetch';

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

  async downloadAndSaveFile(fileUrl: string, userId?: string, originalFileName?: string): Promise<{
    path: string;
    name: string;
    size: number;
  }> {
    try {
      // Download the file
      const response = await fetch(fileUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      // Get the file buffer
      const buffer = await response.buffer();
      
      // Determine file extension
      const contentType = response.headers.get('content-type') || '';
      let extension = '';
      
      if (contentType.includes('pdf')) extension = '.pdf';
      else if (contentType.includes('jpeg')) extension = '.jpg';
      else if (contentType.includes('png')) extension = '.png';
      else if (originalFileName) {
        extension = path.extname(originalFileName);
      } else {
        // Try to get extension from URL
        const urlPath = new URL(fileUrl).pathname;
        extension = path.extname(urlPath) || '.pdf'; // Default to PDF
      }

      // Generate unique filename
      const filename = `${randomUUID()}${extension}`;
      const filePath = path.join(this.uploadsDir, filename);

      // Validate file size
      if (buffer.length > this.maxFileSize) {
        throw new Error(`File size ${buffer.length} exceeds maximum allowed size ${this.maxFileSize}`);
      }

      // Save the file
      await fs.promises.writeFile(filePath, buffer);

      console.log(`📁 Downloaded and saved file from URL: ${filename} (${buffer.length} bytes)`);

      return {
        path: filePath,
        name: originalFileName || filename,
        size: buffer.length
      };

    } catch (error) {
      console.error('❌ Failed to download file from URL:', error);
      throw new Error(`File download failed: ${error.message}`);
    }
  }

  getUploadsDirectory(): string {
    return this.uploadsDir;
  }
}

export const fileService = new FileService();
