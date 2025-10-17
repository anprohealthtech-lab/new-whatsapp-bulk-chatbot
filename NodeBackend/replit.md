# WhatsApp LIMS Integration System

## Overview

A full-stack web application that integrates WhatsApp messaging capabilities with a Laboratory Information Management System (LIMS). The system enables sending text messages and reports (PDF/images) via WhatsApp, manages message history, and provides real-time status updates through a modern web interface.

The application follows a monorepo structure with separate client and server directories, utilizing TypeScript throughout for type safety and maintainability.

**Current Status (January 2025):** Fully functional application with professional dashboard, real-time WebSocket communication, and demo mode support for development environments. The system gracefully handles WhatsApp integration failures by switching to demo mode.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for fast development and optimized builds
- **UI Components**: Radix UI primitives with shadcn/ui component library
- **Styling**: Tailwind CSS with CSS variables for theming
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Form Handling**: React Hook Form with Zod validation
- **Real-time Communication**: WebSocket client for live updates

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **Real-time**: WebSocket server for bidirectional communication
- **File Handling**: Multer for multipart/form-data file uploads
- **Session Management**: Connect-pg-simple for PostgreSQL session storage
- **CORS**: Configured for cross-origin requests from frontend

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Design**: 
  - Users table for authentication
  - Messages table for tracking all sent messages with status
  - System logs table for application monitoring
- **Session Storage**: In-memory fallback with PostgreSQL persistence
- **File Storage**: Local filesystem with temporary upload directory

### Authentication & Authorization
- Session-based authentication using PostgreSQL session store
- User management with username/password authentication
- Session persistence across server restarts

### WhatsApp Integration
- **Library**: whatsapp-web.js for WhatsApp Web API integration
- **Authentication**: QR code-based pairing with persistent sessions
- **Session Management**: LocalAuth strategy with file-based persistence
- **Message Types**: Support for text messages and media attachments (PDF, images)
- **Status Tracking**: Real-time delivery status updates via WebSocket events

### API Design
- RESTful API endpoints:
  - `POST /api/send-message` - Send text messages
  - `POST /api/send-report` - Send messages with attachments
  - `GET /api/status` - System and WhatsApp status
  - `GET /api/messages` - Message history with filtering
  - `POST /api/generate-qr` - Trigger QR code generation
- Real-time WebSocket events for status updates
- Comprehensive error handling and logging

### Development Environment
- **Hot Reload**: Vite HMR for frontend development
- **TypeScript**: Strict type checking across the entire codebase
- **Path Mapping**: Absolute imports with @ aliases
- **Environment Variables**: Centralized configuration management
- **Development Tools**: Built-in error overlay and debugging support

## External Dependencies

### Core Framework Dependencies
- **React Ecosystem**: React 18, React DOM, React Query for state management
- **Node.js Backend**: Express.js, TypeScript runtime with tsx
- **Database**: PostgreSQL with Drizzle ORM and Neon serverless driver
- **Real-time**: WebSocket (ws) for server, native WebSocket API for client

### UI & Styling
- **Component Library**: Radix UI primitives for accessible components
- **Styling**: Tailwind CSS with PostCSS for utility-first styling
- **Icons**: Lucide React for consistent iconography
- **Form Handling**: React Hook Form with Hookform resolvers

### WhatsApp Integration
- **WhatsApp Web**: whatsapp-web.js library for programmatic WhatsApp access
- **QR Code**: qrcode-terminal for console QR code display
- **Session Persistence**: LocalAuth strategy with filesystem storage

### File & Data Processing
- **File Uploads**: Multer for handling multipart/form-data
- **Date Handling**: date-fns for date manipulation and formatting
- **Validation**: Zod for runtime type validation and schema definition
- **UUID Generation**: Built-in crypto module for unique identifiers

### Development & Build Tools
- **Build System**: Vite with React plugin and ESBuild
- **TypeScript**: Full TypeScript support with strict configuration
- **CORS**: cors middleware for cross-origin request handling
- **Environment**: dotenv for environment variable management
- **Replit Integration**: Replit-specific plugins for development environment