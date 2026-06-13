# Voice Agent Service

Separate deployable voice layer for the existing AI agent platform.

This service owns live audio transport and provider glue:

- Authenticated widget studio at `/`
- Embeddable browser voice Q&A at `/?embed=<voice-agent-id>`
- Browser WebSocket audio endpoint at `/browser/media`
- Twilio webhook at `/twilio/voice`
- Twilio Media Streams WebSocket endpoint at `/twilio/media`
- OpenAI STT provider, plus optional pluggable STT HTTP provider
- Fish Audio TTS provider, plus optional pluggable TTS HTTP provider
- Platform connector that calls your existing app for the actual AI answer

The main platform should remain the source of truth for users, tenants, agents, knowledge base, prompts, and conversation history.

## Website Widget

Set the main application URL so the voice studio can reuse its login, tenant, and voice-agent records:

```text
MAIN_PLATFORM_URL=https://your-main-platform.com
VOICE_SESSION_TOKEN_SECRET=the-same-secret-used-by-the-main-platform
```

`MAIN_PLATFORM_URL` is not supplied by another provider. It is the public root URL of the deployed main `NodeBackend`, for example `https://app.example.com`. For local development use the main backend origin, such as `http://localhost:5000`.

Create `VOICE_SESSION_TOKEN_SECRET` yourself as a long random secret. Set the exact same value in the main backend and VoiceAgentService. In PowerShell, one suitable command is:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Also set `VOICE_AGENT_SHARED_SECRET` in the main backend to the same value as `PLATFORM_AGENT_SECRET` in VoiceAgentService. Keep this separate from the session-token secret.

Sign in at the voice-service root URL, select an existing voice agent, upload its assistant image, save the widget branding, and copy the generated script:

```html
<script src="https://voice.yourdomain.com/embed.js" data-agent-id="VOICE_AGENT_ID" async></script>
```

Website visitors receive a short-lived, agent-scoped browser token. Organization and user IDs are not entered or exposed in the widget.

## Languages

OpenAI transcription uses automatic language detection by default. A tenant STT credential may set `settings.language` to an ISO-639-1 code such as `hi`, `en`, or `es` when a fixed hint is preferred. Voice agents default to `languageMode=match_speaker`, which instructs the main agent to answer in the language used by the visitor. Fish Audio output depends on the selected model and cloned voice supporting that language.

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

## Speech-To-Text

Recommended DigitalOcean env values for OpenAI STT:

```text
STT_PROVIDER=openai
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
OPENAI_TRANSCRIPTIONS_URL=https://api.openai.com/v1/audio/transcriptions
```

Supported model values are controlled by OpenAI. Good starting choices:

```text
gpt-4o-mini-transcribe
gpt-4o-transcribe
whisper-1
```

For browser testing, the service sends `audio/webm;codecs=opus` to OpenAI. For Twilio testing, it wraps 8k mu-law frames in a WAV container before transcription.

## Provider Contracts

You only need this STT contract if `STT_PROVIDER=http`.

## Text-To-Speech

Recommended DigitalOcean env values for Fish Audio:

```text
TTS_PROVIDER=fish
FISH_AUDIO_API_KEY=your-fish-audio-api-key
FISH_AUDIO_TTS_URL=https://api.fish.audio/v1/tts
FISH_AUDIO_MODEL=s2-pro
FISH_AUDIO_REFERENCE_ID=your-cloned-voice-model-id
FISH_AUDIO_FORMAT=mp3
FISH_AUDIO_MP3_BITRATE=128
FISH_AUDIO_LATENCY=normal
FISH_AUDIO_TEMPERATURE=0.7
FISH_AUDIO_TOP_P=0.7
FISH_AUDIO_SPEED=1
FISH_AUDIO_VOLUME=0
```

Fish Audio calls the cloned voice ID `reference_id`. If your model page is:

```text
https://fish.audio/m/802e3bc2b27e49c2995d23ef70e6ac89
```

then set:

```text
FISH_AUDIO_REFERENCE_ID=802e3bc2b27e49c2995d23ef70e6ac89
```

For simple browser testing, use `FISH_AUDIO_FORMAT=mp3`. Twilio phone-call playback still needs an 8kHz mu-law conversion step later.

## Pre-generated Flow Audio Cache

For campaign-style flows, the service can pre-generate fixed TTS chunks once, upload the audio to Supabase Storage, and reuse the saved URL during normal flow playback.

Required env values:

```text
DATABASE_URL=postgres://...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
VOICE_AUDIO_BUCKET=voice-flow-audio
VOICE_CACHE_ADMIN_TOKEN=optional-admin-token
```

Open the browser test console, enter the tenant IDs, choose the flow, then use **Generate** in the Flow Audio Cache panel. Runtime flow playback automatically uses cached audio URLs when the row exists.

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

You only need this TTS contract if `TTS_PROVIDER=http`.

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
