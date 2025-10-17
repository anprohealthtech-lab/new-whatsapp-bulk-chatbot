# WhatsApp LIMS External API Documentation

## Overview
This WhatsApp LIMS system provides REST APIs for external applications to manage WhatsApp sessions, send messages, and monitor system health. The system is designed to be used as a backend service by your frontend application.

## Authentication
All API endpoints require an API Key in the headers:
```
X-API-Key: your-api-key-here
```

## Base URL
```
Production: https://starfish-app-b53k3.ondigitalocean.app/api/external
Local: http://localhost:3001/api/external
```

---

## 📱 Session Management

### 1. Create WhatsApp Session
**POST** `/sessions/create`

Creates a new WhatsApp session for a user from your external app.

**Request Body:**
```json
{
  "userId": "uuid-from-your-app",
  "organizationId": "organization-uuid",
  "phoneNumber": "+1234567890", // optional
  "strategy": "business_hours", // business_hours|always_on|on_demand
  "userInfo": {
    "username": "lab_technician_1",
    "email": "tech@lab.com",
    "role": "user",
    "organizationName": "ABC Medical Lab"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-uuid",
    "userId": "user-uuid",
    "strategy": "business_hours",
    "qrCode": "raw-qr-code-data",
    "qrCodeUrl": "https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=...",
    "status": "active",
    "isAuthenticated": false,
    "createdAt": "2024-01-01T10:00:00Z"
  }
}
```

### 2. Get Session Status & Health
**GET** `/sessions/{sessionId}/status`

Check the health and status of a WhatsApp session.

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-uuid",
    "userId": "user-uuid", 
    "phoneNumber": "+1234567890",
    "isActive": true,
    "isAuthenticated": true,
    "status": "connected", // connected|connecting|disconnected
    "lastActivity": "2024-01-01T10:30:00Z",
    "connectionAttempts": 1,
    "strategy": "business_hours",
    "health": {
      "messagesSent": 15,
      "messagesReceived": 5,
      "errors": 0,
      "uptime": 3600
    },
    "qrCode": null,
    "qrCodeUrl": null
  }
}
```

### 3. Get Fresh QR Code  
**GET** `/sessions/{sessionId}/qr`

Get a fresh QR code for WhatsApp connection.

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-uuid",
    "qrCode": "raw-qr-data",
    "qrCodeUrl": "https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=...",
    "isAuthenticated": false,
    "status": "waiting_for_scan"
  }
}
```

### 4. Disconnect Session
**DELETE** `/sessions/{sessionId}`

Disconnect and terminate a WhatsApp session.

**Response:**
```json
{
  "success": true,
  "message": "Session disconnected successfully",
  "data": {
    "sessionId": "session-uuid",
    "disconnectedAt": "2024-01-01T11:00:00Z"
  }
}
```

---

## 💬 Message Sending

### 1. Send Text Message
**POST** `/messages/send`

Send a text message through WhatsApp.

**Request Body:**
```json
{
  "sessionId": "session-uuid",
  "phoneNumber": "+1234567890",
  "content": "Hello [PatientName], your test results are ready.",
  "templateData": {
    "PatientName": "John Doe",
    "TestName": "Blood Test",
    "ReportDate": "2024-01-01"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "messageId": "msg-uuid",
    "sessionId": "session-uuid",
    "to": "+1234567890",
    "content": "Hello John Doe, your test results are ready.",
    "status": "sent",
    "sentAt": "2024-01-01T10:15:00Z"
  }
}
```

### 2. Send Report with File
**POST** `/reports/send`

Send a lab report with PDF file attachment.

**Request (multipart/form-data):**
- `sessionId`: session-uuid
- `phoneNumber`: +1234567890
- `content`: Dear [PatientName], please find your [TestName] report attached.
- `templateData`: {"PatientName": "John Doe", "TestName": "Blood Test"}
- `file`: (PDF file)

**Response:**
```json
{
  "success": true,
  "data": {
    "messageId": "msg-uuid",
    "sessionId": "session-uuid", 
    "to": "+1234567890",
    "content": "Dear John Doe, please find your Blood Test report attached.",
    "fileName": "blood_test_report.pdf",
    "status": "sent",
    "sentAt": "2024-01-01T10:20:00Z"
  }
}
```

---

## 👥 User Management

### 1. Update User Information
**PUT** `/users/{userId}`

Update user information in the WhatsApp LIMS system.

**Request Body:**
```json
{
  "username": "updated_username",
  "email": "newemail@lab.com", 
  "role": "manager",
  "organizationId": "new-org-uuid",
  "organizationName": "New Lab Name"
}
```

### 2. Get User Sessions
**GET** `/users/{userId}/sessions`

Get all active sessions for a specific user.

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user-uuid",
    "sessions": [
      {
        "sessionId": "session-1-uuid",
        "phoneNumber": "+1234567890",
        "isActive": true,
        "isAuthenticated": true,
        "status": "connected",
        "strategy": "business_hours",
        "lastActivity": "2024-01-01T10:30:00Z",
        "connectionAttempts": 1
      }
    ],
    "totalSessions": 1
  }
}
```

---

## 🔍 Monitoring & Health

### 1. System Health Check
**GET** `/health`

Check overall system health and status.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-01T10:00:00Z", 
    "uptime": 86400,
    "system": {
      "totalSessions": 5,
      "activeSessions": 3,
      "authenticatedSessions": 2,
      "sessionsPerUser": {
        "user-1": 2,
        "user-2": 1
      }
    },
    "version": "1.0.0"
  }
}
```

### 2. Get Message History
**GET** `/messages/history?sessionId={sessionId}&userId={userId}&limit=50&offset=0`

Retrieve message history for a session or user.

**Response:**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "msg-uuid",
        "to": "+1234567890",
        "content": "Message content",
        "status": "delivered",
        "type": "text",
        "createdAt": "2024-01-01T10:15:00Z"
      }
    ],
    "total": 1,
    "limit": 50,
    "offset": 0
  }
}
```

---

## 🚫 Error Handling

All API endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human readable error message"
}
```

### Common Error Codes:
- `UNAUTHORIZED`: Invalid or missing API key
- `VALIDATION_ERROR`: Request validation failed
- `SESSION_NOT_FOUND`: Session ID does not exist
- `SESSION_NOT_READY`: Session not connected to WhatsApp
- `MESSAGE_SEND_FAILED`: Failed to send message
- `FILE_VALIDATION_FAILED`: File upload validation failed
- `SERVER_ERROR`: Internal server error

### HTTP Status Codes:
- `200`: Success
- `400`: Bad Request (validation error)
- `401`: Unauthorized (invalid API key)
- `404`: Not Found (resource not found)
- `500`: Internal Server Error

---

## 🔄 Integration Workflow

### Typical Integration Flow:

1. **User Registration in Your App**
   - User signs up in your frontend app
   - Store user data in your database

2. **Create WhatsApp Session**
   ```javascript
   POST /api/external/sessions/create
   {
     "userId": "from-your-database",
     "organizationId": "from-your-database", 
     "userInfo": {...}
   }
   ```

3. **Show QR Code to User**
   - Display `qrCodeUrl` in your frontend
   - User scans with WhatsApp mobile app

4. **Monitor Session Health**
   ```javascript
   GET /api/external/sessions/{sessionId}/status
   // Poll every 30 seconds to check connection
   ```

5. **Send Messages/Reports**
   ```javascript
   POST /api/external/messages/send
   // or
   POST /api/external/reports/send
   ```

6. **Handle Disconnections**
   - Monitor session status
   - Generate fresh QR codes when needed
   - Reconnect automatically

---

## 🔐 Security Notes

1. **API Key Security**: Store API key securely in environment variables
2. **HTTPS Only**: Use HTTPS in production 
3. **Rate Limiting**: Respect rate limits to avoid blocking
4. **Session Management**: Monitor and cleanup inactive sessions
5. **File Validation**: Only upload valid PDF/image files

---

## 📞 Support

For integration support or questions:
- Check system health: `GET /api/external/health`
- Monitor logs for errors
- Ensure proper API key configuration