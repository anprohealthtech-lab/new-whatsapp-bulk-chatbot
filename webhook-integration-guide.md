# Webhook Integration Guide - User Sync

## Overview
This guide explains how to sync users from your external app to the WhatsApp service.

## Database Changes
**No database schema changes are needed.** The recent fix for duplicate disconnect broadcasts was handled entirely in-memory.

## User Mapping
Users are identified by **UUID (`id`)** which is your primary mapping key.

### Required Fields
When adding a user, you **MUST** provide:
- `id` - UUID from your external app (this is your mapping key)
- `username` - Unique username
- `email` - User email address

### Optional Fields
- `clinic_name` - Organization/clinic name (defaults to username)
- `contact_whatsapp` - WhatsApp contact number
- `role` - User role: `'admin'`, `'manager'`, `'user'` (default: `'user'`)
- `is_active` - Boolean, is user active (default: `true`)
- `whatsapp_enabled` - Boolean, enable WhatsApp for user (default: `true`)
- `max_sessions` - Max concurrent WhatsApp sessions (default: `1`)

---

## Integration Methods

### Method 1: HTTP API (Recommended for Webhooks)

#### Single User Sync
```bash
POST http://your-server:3001/api/external/users/sync
Content-Type: application/json
X-API-Key: your-api-key-here

{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "dr.smith@clinic.com",
  "username": "dr.smith",
  "clinic_name": "City Medical Center",
  "contact_whatsapp": "+1234567890",
  "role": "doctor",
  "is_active": true,
  "whatsapp_enabled": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "dr.smith",
    "email": "dr.smith@clinic.com",
    "clinic_name": "City Medical Center",
    "role": "doctor",
    "is_active": true
  },
  "message": "User synchronized successfully"
}
```

#### Bulk User Sync
```bash
POST http://your-server:3001/api/external/users/bulk-sync
Content-Type: application/json
X-API-Key: your-api-key-here

{
  "users": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "dr.smith@clinic.com",
      "username": "dr.smith",
      "clinic_name": "City Medical Center"
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "email": "dr.jones@clinic.com",
      "username": "dr.jones",
      "clinic_name": "Suburban Health Clinic"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 2,
    "successful": 2,
    "failed": 0,
    "results": [...]
  },
  "message": "Synchronized 2 users, 0 failed"
}
```

---

### Method 2: Direct Database Script

```bash
# From NodeBackend directory
node scripts/add-user-webhook.js \
  "550e8400-e29b-41d4-a716-446655440000" \
  "dr.smith" \
  "dr.smith@clinic.com" \
  "City Medical Center" \
  "doctor" \
  "+1234567890"
```

---

## Example Webhook Implementation (Your External App)

### Node.js Example
```javascript
const axios = require('axios');

async function syncUserToWhatsApp(user) {
  try {
    const response = await axios.post(
      'http://whatsapp-service:3001/api/external/users/sync',
      {
        id: user.id,                    // Your user UUID
        email: user.email,              // Required
        username: user.username,        // Required
        clinic_name: user.clinic_name,  // Optional
        contact_whatsapp: user.phone,   // Optional
        role: user.role,                // Optional
        is_active: user.is_active,      // Optional
        whatsapp_enabled: true          // Optional
      },
      {
        headers: {
          'X-API-Key': process.env.WHATSAPP_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('User synced:', response.data);
    return response.data;
  } catch (error) {
    console.error('Sync failed:', error.response?.data || error.message);
    throw error;
  }
}

// Usage in your webhook/event handler
app.post('/users', async (req, res) => {
  const newUser = await createUser(req.body);
  
  // Sync to WhatsApp service
  await syncUserToWhatsApp(newUser);
  
  res.json(newUser);
});
```

### Python Example
```python
import requests

def sync_user_to_whatsapp(user):
    url = 'http://whatsapp-service:3001/api/external/users/sync'
    headers = {
        'X-API-Key': os.getenv('WHATSAPP_API_KEY'),
        'Content-Type': 'application/json'
    }
    
    payload = {
        'id': str(user.id),              # Your user UUID
        'email': user.email,             # Required
        'username': user.username,       # Required
        'clinic_name': user.clinic_name, # Optional
        'contact_whatsapp': user.phone,  # Optional
        'role': user.role,               # Optional
        'is_active': user.is_active,     # Optional
        'whatsapp_enabled': True         # Optional
    }
    
    response = requests.post(url, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()
```

---

## API Key Setup

Set this in your `.env` file:
```env
API_KEY=whatsapp-lims-secure-api-key-2024
```

Change this to a secure random key in production!

---

## User Lifecycle Flow

1. **User Created in Your App** → Webhook → POST `/api/external/users/sync`
2. **User Synced** → User can now use WhatsApp service
3. **Connect WhatsApp** → POST `/api/users/{userId}/whatsapp/connect`
4. **Send Messages** → POST `/api/users/{userId}/whatsapp/send-message`

---

## Important Notes

### User ID Mapping
- The `id` field is **your external app's user UUID**
- This is the **primary mapping key** between systems
- Once a user is synced, use this `id` in all API calls: `/api/users/{id}/whatsapp/*`

### Username Support
- You can also lookup users by `username` instead of UUID
- Example: `/api/users/dr.smith/whatsapp/status` (automatically resolves to UUID)
- Username must be unique

### Upsert Behavior
- The sync endpoint uses UPSERT (insert or update)
- If `id` already exists → updates the user
- If `id` doesn't exist → creates new user
- Safe to call multiple times

### Error Handling
Always check the `success` field in responses:
```javascript
const result = await syncUser(userData);
if (!result.success) {
  console.error('Sync failed:', result.error);
  // Handle error
}
```

---

## Testing

### 1. Test the script directly:
```bash
cd NodeBackend
export DATABASE_URL="your-connection-string"
node scripts/add-user-webhook.js \
  "test-user-id-123" \
  "testuser" \
  "test@example.com" \
  "Test Clinic"
```

### 2. Test the API:
```bash
curl -X POST http://localhost:3001/api/external/users/sync \
  -H "Content-Type: application/json" \
  -H "X-API-Key: whatsapp-lims-secure-api-key-2024" \
  -d '{
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "test@example.com",
    "username": "testuser"
  }'
```

### 3. Verify user was created:
```bash
curl http://localhost:3001/api/external/users \
  -H "X-API-Key: whatsapp-lims-secure-api-key-2024"
```

---

## Quick Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | ✅ Yes | Your app's user UUID (mapping key) |
| `username` | string | ✅ Yes | Unique username |
| `email` | email | ✅ Yes | User email |
| `clinic_name` | string | ❌ No | Organization name |
| `contact_whatsapp` | string | ❌ No | WhatsApp number |
| `role` | string | ❌ No | User role (admin/manager/user) |
| `is_active` | boolean | ❌ No | Is user active (default: true) |
| `whatsapp_enabled` | boolean | ❌ No | Enable WhatsApp (default: true) |
