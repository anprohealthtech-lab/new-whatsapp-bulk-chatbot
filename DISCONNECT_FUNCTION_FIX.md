# Disconnect Function Fix

## Correct backend route

Use this route and method:

- `DELETE /api/users/:userId/whatsapp/session`

In this project, the active Express route is:

- `NodeBackend/server/routes.ts` -> `app.delete('/api/users/:userId/whatsapp/session', ...)`

## Correct Netlify function code

```ts
import type { Handler } from '@netlify/functions';
import { corsHeaders, ensureLabContext, forwardToWhatsApp, ok, error, parseRequestBody } from './_shared/whatsappClient';
import { getUserIdFromAuthId } from './_shared/userLookup';

const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const body = parseRequestBody(event.body);
    ensureLabContext(body);

    // auth_id from OPD system
    const authId = body.userId || body.authId || body.profileId;
    if (!authId) {
      return error('userId is required to disconnect WhatsApp', 400);
    }

    // Map OPD auth_id -> backend userId
    const backendUserId = await getUserIdFromAuthId(authId);
    if (!backendUserId) {
      return error('User not found in WhatsApp backend. Please ensure you are logged in and synced.', 404);
    }

    const payload = await forwardToWhatsApp({
      path: `/api/users/${backendUserId}/whatsapp/session`,
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    return ok(payload);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to disconnect WhatsApp');
  }
};

export { handler };
```

## What was wrong

- Wrong path used: `/api/users/{userId}/whatsapp/disconnect`
- Wrong method used: `POST`

Both must be changed to:

- Path: `/api/users/{userId}/whatsapp/session`
- Method: `DELETE`
