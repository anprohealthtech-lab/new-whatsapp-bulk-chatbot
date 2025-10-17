# WhatsApp LIMS Backend API - Complete Endpoint Reference

## Base URL
https://node-backend-dranand.replit.app

---

## QR Code Management

### Generate QR Code
**POST** `/api/generate-qr`
- Response: 404 Not Found (as of now, endpoint not available)

### Get Current QR Code
**GET** `/api/qr-code`
- Response:
```json
{
  "success": true,
  "qrCode": "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=...",
  "message": "Test QR for immediate verification",
  "isReal": true,
  "isTest": true
}
```

---

## Message Management

### Send Text Message
**POST** `/api/send-message`
- Content-Type: application/json
- Body:
```json
{
  "phoneNumber": "+1234567890",
  "content": "Laboratory test results are ready for pickup."
}
```

### Send Report with Attachment
**POST** `/api/send-report`
- Content-Type: multipart/form-data
- Fields: phoneNumber, sampleId, content, file

### Get Message History
**GET** `/api/messages?status=all&limit=50&offset=0`
- Query Parameters: status, search, limit, offset
- Response:
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "d4b0be02-cc20-4e25-a1e9-e67b1071bb2b",
        "phoneNumber": "+1234567890",
        "content": "Testing persistent storage!",
        "type": "text",
        "status": "sent",
        "fileUrl": null,
        "fileName": null,
        "fileSize": null,
        "sampleId": null,
        "metadata": { "whatsappId": "demo_1754542024150", "whatsappTimestamp": 175454202415 },
        "createdAt": "2025-08-07T04:47:04.100Z",
        "sentAt": "2025-08-07T04:47:04.150Z",
        "deliveredAt": null
      }
    ],
    "total": "1",
    "limit": 1,
    "offset": 0
  }
}
```

---

## System Status & Monitoring

### Get System Status
**GET** `/api/status`
- Response:
```json
{
  "success": true,
  "data": {
    "whatsapp": {
      "isConnected": false,
      "isAuthenticated": false,
      "lastSeen": null,
      "sessionInfo": null
    },
    "stats": {
      "totalMessages": "1",
      "sentToday": 1,
      "deliveredToday": 0,
      "failedToday": 0,
      "pendingCount": "0"
    },
    "systemLogs": [
      {
        "id": "a0000515-46db-40ed-9a97-3e9baa3e9431",
        "level": "info",
        "message": "Text message sent to 1234567890",
        "metadata": { "messageId": "d4b0be02-cc20-4e25-a1e9-e67b1071bb2b", "whatsappId": "demo_1754542024150" },
        "createdAt": "2025-08-07T04:47:04.275Z"
      }
    ],
    "timestamp": "2025-08-07T07:58:09.498Z"
  }
}
```

---

## Real-time WebSocket

### WebSocket Connection
**wss://node-backend-dranand.replit.app/ws**

#### Event Types:
- `qr-code`: New QR code generated
- `whatsapp-status`: Connection status updates
- `whatsapp-authenticated`: Successful authentication
- `whatsapp-auth-failure`: Authentication failed
- `message-sent`: Message successfully sent
- `message-update`: Delivery status updates
- `disconnected`: WhatsApp disconnected
