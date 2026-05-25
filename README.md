# Voice Agent Service

Separate deployable voice layer for the existing AI agent platform.

This service owns live audio transport and provider glue:

- Browser microphone test UI at `/`
- Browser WebSocket audio endpoint at `/browser/media`
- Twilio webhook at `/twilio/voice`
- Twilio Media Streams WebSocket endpoint at `/twilio/media`
- Pluggable STT HTTP provider
- Pluggable TTS HTTP provider
- Platform connector that calls your existing app for the actual AI answer

The main platform should remain the source of truth for users, tenants, agents, knowledge base, prompts, and conversation history.

## Architecture

```text
Browser or Twilio
  -> VoiceAgentService
  -> STT provider
  -> Existing platform agent endpoint
  -> TTS provider
  -> Browser or Twilio audio response
```

## Required Main Platform Endpoint

Create this endpoint in the existing platform:

```http
POST /api/voice-agent/respond
x-voice-agent-secret: <PLATFORM_AGENT_SECRET>
content-type: application/json
```

Request body:

```json
{
  "text": "caller transcript",
  "channel": "browser",
  "sessionId": "call-or-browser-session-id",
  "callerId": "+919999999999",
  "organizationId": "org-id",
  "userId": "user-id"
}
```

Response body:

```json
{
  "text": "agent reply text",
  "metadata": {}
}
```

That endpoint should reuse your existing chatbot/RAG/knowledge-base logic and save transcript records if required.

## Provider Contracts

STT endpoint receives:

```json
{
  "audioBase64": "...",
  "encoding": "webm-opus",
  "sampleRate": 48000,
  "mimeType": "audio/webm;codecs=opus",
  "sessionId": "..."
}
```

STT endpoint returns:

```json
{ "text": "hello, I want to book a test" }
```

TTS endpoint receives:

```json
{
  "text": "Sure, I can help.",
  "voiceId": "default",
  "channel": "browser",
  "preferredFormats": ["mp3", "wav", "webm"]
}
```

TTS endpoint returns one of:

```json
{ "audioBase64": "...", "mimeType": "audio/mpeg" }
```

```json
{ "audioUrl": "https://..." }
```

For Twilio live bidirectional playback, return:

```json
{ "twilioMulawBase64": "..." }
```

Twilio Media Streams expects 8kHz mu-law audio payloads. If your purchased TTS only returns MP3, add an audio conversion step before using phone-call playback.

## Local Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:8080
```

## Twilio Setup

Point the Twilio number voice webhook to:

```text
https://your-voice-service-domain.com/twilio/voice
```

For a tenant-specific number, include query parameters:

```text
https://your-voice-service-domain.com/twilio/voice?organizationId=org_123&userId=user_123
```

## DigitalOcean

This folder has a `Dockerfile` and `.do/app.yaml`. Push this folder to its own GitHub repo, then create a DigitalOcean App from that repo.

Set the secrets from `.env.example` in the DigitalOcean dashboard.

## Honest MVP Notes

This scaffold is production-shaped, but not the final voice brain yet.

Before selling it as live phone support, add:

- real voice activity detection instead of fixed chunk windows
- interruption/barge-in handling
- Twilio signature validation enabled
- call recording/transcript storage
- retry and fallback messages
- TTS conversion to Twilio 8k mu-law if your TTS provider does not return it directly
