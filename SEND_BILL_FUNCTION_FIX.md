# WhatsApp Send Bill Function Fix

## Correct backend route

Use this route and method:

- `POST /api/external/reports/send-url`

In this project, the route is protected by API key auth:

- `NodeBackend/server/api-routes.ts` -> `router.post('/external/reports/send-url', apiKeyAuth, ...)`

## Required request shape for this route

Send only fields expected by backend validation:

- `userId` (UUID or username resolvable by backend)
- `phoneNumber`
- `fileUrl`
- `caption` (optional)
- `fileName` (optional)
- `sessionId` (optional)
- `templateData` (optional)

`x-api-key` must be present (directly or via proxy forwarding).

## Corrected Netlify function code

```js
// netlify/functions/whatsapp-send-bill.js
// Sends invoice PDF via WhatsApp using /api/external/reports/send-url

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const getBaseUrl = (event) => {
  const proto =
    event.headers?.['x-forwarded-proto'] ||
    event.headers?.['X-Forwarded-Proto'] ||
    'https';
  const host =
    event.headers?.host ||
    event.headers?.Host ||
    process.env.URL?.replace(/^https?:\/\//, '') ||
    '';
  return host ? `${proto}://${host}` : '';
};

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: 'ok' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method Not Allowed' });
  }

  try {
    const contentType = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      return json(400, { success: false, error: 'Content-Type must be application/json' });
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const {
      userId,
      username,
      phoneNumber,
      phone,
      fileUrl,
      caption,
      fileName,
      billNumber,
      patientName,
      totalAmount,
    } = body;

    // IMPORTANT: backend /send-url expects UUID or username in userId field.
    // Do not pass OPD auth_id unless it is already mapped to backend user UUID/username.
    const primaryUserIdentifier = userId || username;
    if (!primaryUserIdentifier) {
      return json(400, {
        success: false,
        error: 'userId (backend UUID/username) or username is required',
      });
    }

    if (!fileUrl) return json(400, { success: false, error: 'fileUrl is required' });

    let resolvedPhone = phoneNumber || phone || null;
    if (!resolvedPhone) {
      return json(400, { success: false, error: 'phoneNumber or phone is required' });
    }

    // Normalize phone
    resolvedPhone = String(resolvedPhone).replace(/[\s\-\(\)]/g, '');
    if (resolvedPhone.startsWith('+')) resolvedPhone = resolvedPhone.slice(1);
    if (!resolvedPhone.startsWith('91') && resolvedPhone.length === 10) resolvedPhone = `91${resolvedPhone}`;

    let finalCaption = caption;
    if (!finalCaption && patientName && billNumber && totalAmount !== undefined) {
      finalCaption = `Hello ${patientName},\n\nThank you for your visit!\n\nYour bill ${billNumber} for Rs ${totalAmount} is attached.\n\nPlease find your invoice attached.`;
    } else if (!finalCaption) {
      finalCaption = 'Your invoice is attached.';
    }

    const payload = {
      userId: primaryUserIdentifier,
      phoneNumber: resolvedPhone,
      fileUrl,
      caption: finalCaption,
      fileName: fileName || `bill_${billNumber || 'invoice'}.pdf`,
    };

    const baseUrl = getBaseUrl(event);
    if (!baseUrl) {
      return json(500, { success: false, error: 'Unable to resolve function base URL' });
    }

    // Must match backend apiKeyAuth
    const apiKey = process.env.WHATSAPP_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      return json(500, {
        success: false,
        error: 'Missing WHATSAPP_API_KEY/API_KEY env var for external API authentication',
      });
    }

    const callExternal = async (identifier) =>
      fetch(`${baseUrl}/.netlify/functions/whatsapp-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: '/api/external/reports/send-url',
          method: 'POST',
          headers: { 'x-api-key': apiKey },
          body: { ...payload, userId: identifier },
        }),
      });

    let upstream = await callExternal(primaryUserIdentifier);
    let text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { success: upstream.ok, raw: text };
    }

    // Optional fallback: if primary identifier is UUID and backend also uses username, try username.
    if (!upstream.ok && username && isUuid(primaryUserIdentifier)) {
      upstream = await callExternal(username);
      text = await upstream.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { success: upstream.ok, raw: text };
      }
    }

    if (!upstream.ok) {
      return json(upstream.status, {
        success: false,
        error: data?.error || data?.message || 'Failed to send WhatsApp bill',
        details: data,
      });
    }

    return json(200, data);
  } catch (err) {
    console.error('Handler error:', err && err.stack ? err.stack : String(err));
    return json(500, {
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? String(err) : undefined,
    });
  }
};
```

## What was mismatched before

- Function accepted `userId` that may be OPD auth id, but backend expects UUID/username resolvable internally.
- Retry with `email` is unreliable unless backend username equals email.
- External route requires `x-api-key`; proxy call must pass it through.
- Payload included extra fields (`labId`, `clinicId`, `phone`, `reportUrl`) not used by this endpoint.
