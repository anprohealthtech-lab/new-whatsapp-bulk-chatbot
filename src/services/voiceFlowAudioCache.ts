import crypto from "node:crypto";
import { config } from "../config.js";
import { requireDatabase, sql } from "../db.js";
import { synthesizeSpeech } from "./tts.js";
import type { TextToSpeechOutput, VoiceContext } from "../types.js";

export interface VoiceFlowCacheKey {
  organizationId: string;
  userId: string;
  flowId: string;
  flowVersion: number;
  voiceProfileId?: string;
  nodeId: string;
  chunkIndex: number;
  text: string;
}

export interface VoiceFlowCachedChunk {
  id?: string;
  audio: TextToSpeechOutput;
  text: string;
  index: number;
  cached: boolean;
}

interface VoiceFlowChunkRow {
  id: string;
  organization_id: string;
  user_id: string;
  flow_id: string;
  flow_version: number;
  voice_profile_id: string | null;
  node_id: string;
  chunk_index: number;
  text: string;
  text_hash: string;
  voice_provider: string;
  voice_id: string | null;
  audio_path: string;
  audio_url: string;
  mime_type: string;
  byte_size: number | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export function isVoiceCacheConfigured(): boolean {
  return Boolean(sql && config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY);
}

export async function getOrCreateFlowAudioChunk(
  key: VoiceFlowCacheKey,
  context: VoiceContext
): Promise<VoiceFlowCachedChunk> {
  const existing = await findCachedChunk(key);
  if (existing) {
    return {
      id: existing.id,
      text: existing.text,
      index: existing.chunk_index,
      cached: true,
      audio: {
        audioUrl: existing.audio_url,
        mimeType: existing.mime_type
      }
    };
  }

  const speech = await synthesizeSpeech({ text: key.text, context });
  const audioBase64 = speech.audioBase64;
  if (!audioBase64) {
    return {
      text: key.text,
      index: key.chunkIndex,
      cached: false,
      audio: speech
    };
  }

  const mimeType = speech.mimeType || "audio/mpeg";
  const audioBuffer = Buffer.from(audioBase64, "base64");
  const audioPath = buildAudioPath(key, mimeType);
  const audioUrl = await uploadToSupabaseStorage(audioPath, audioBuffer, mimeType);
  const row = await saveCachedChunk(key, audioPath, audioUrl, mimeType, audioBuffer.length);

  return {
    id: row.id,
    text: key.text,
    index: key.chunkIndex,
    cached: false,
    audio: {
      audioUrl,
      mimeType
    }
  };
}

export async function listFlowAudioChunks(params: {
  organizationId: string;
  userId: string;
  flowId?: string;
}): Promise<VoiceFlowChunkRow[]> {
  const db = requireDatabase();
  if (params.flowId) {
    return db<VoiceFlowChunkRow[]>`
      SELECT *
      FROM voice_flow_audio_chunks
      WHERE organization_id = ${params.organizationId}
        AND user_id = ${params.userId}
        AND flow_id = ${params.flowId}
      ORDER BY flow_id, node_id, chunk_index, created_at
    `;
  }

  return db<VoiceFlowChunkRow[]>`
    SELECT *
    FROM voice_flow_audio_chunks
    WHERE organization_id = ${params.organizationId}
      AND user_id = ${params.userId}
    ORDER BY flow_id, node_id, chunk_index, created_at
  `;
}

async function findCachedChunk(key: VoiceFlowCacheKey): Promise<VoiceFlowChunkRow | null> {
  if (!isVoiceCacheConfigured()) return null;
  const db = requireDatabase();
  const rows = await db<VoiceFlowChunkRow[]>`
    SELECT *
    FROM voice_flow_audio_chunks
    WHERE organization_id = ${key.organizationId}
      AND user_id = ${key.userId}
      AND flow_id = ${key.flowId}
      AND flow_version = ${key.flowVersion}
      AND COALESCE(voice_profile_id, '') = ${key.voiceProfileId || ""}
      AND node_id = ${key.nodeId}
      AND chunk_index = ${key.chunkIndex}
      AND text_hash = ${hashText(key.text)}
      AND voice_provider = ${getVoiceProvider(key)}
      AND COALESCE(voice_id, '') = ${getVoiceId(key)}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function saveCachedChunk(
  key: VoiceFlowCacheKey,
  audioPath: string,
  audioUrl: string,
  mimeType: string,
  byteSize: number
): Promise<VoiceFlowChunkRow> {
  const db = requireDatabase();
  const existing = await findCachedChunk(key);
  if (existing) {
    const rows = await db<VoiceFlowChunkRow[]>`
      UPDATE voice_flow_audio_chunks
      SET audio_path = ${audioPath},
        audio_url = ${audioUrl},
        mime_type = ${mimeType},
        byte_size = ${byteSize},
        metadata = ${JSON.stringify({
          ttsProvider: getVoiceProvider(key),
          fishModel: config.FISH_AUDIO_MODEL,
          fishFormat: config.FISH_AUDIO_FORMAT
        })},
        updated_at = now()
      WHERE id = ${existing.id}
      RETURNING *
    `;
    return rows[0];
  }

  const rows = await db<VoiceFlowChunkRow[]>`
    INSERT INTO voice_flow_audio_chunks (
      organization_id,
      user_id,
      flow_id,
      flow_version,
      voice_profile_id,
      node_id,
      chunk_index,
      text,
      text_hash,
      voice_provider,
      voice_id,
      audio_path,
      audio_url,
      mime_type,
      byte_size,
      metadata,
      updated_at
    ) VALUES (
      ${key.organizationId},
      ${key.userId},
      ${key.flowId},
      ${key.flowVersion},
      ${key.voiceProfileId || null},
      ${key.nodeId},
      ${key.chunkIndex},
      ${key.text},
      ${hashText(key.text)},
      ${getVoiceProvider(key)},
      ${getVoiceId(key) || null},
      ${audioPath},
      ${audioUrl},
      ${mimeType},
      ${byteSize},
      ${JSON.stringify({
        ttsProvider: getVoiceProvider(key),
        fishModel: config.FISH_AUDIO_MODEL,
        fishFormat: config.FISH_AUDIO_FORMAT
      })},
      now()
    )
    RETURNING *
  `;
  return rows[0];
}

async function uploadToSupabaseStorage(path: string, body: Buffer, mimeType: string): Promise<string> {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for voice audio cache");
  }

  await ensureSupabaseBucket();

  const baseUrl = config.SUPABASE_URL.replace(/\/$/, "");
  const uploadUrl = `${baseUrl}/storage/v1/object/${config.VOICE_AUDIO_BUCKET}/${path}`;
  const uploadBody = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": mimeType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-upsert": "true"
    },
    body: uploadBody
  });

  if (!response.ok) {
    throw new Error(`Supabase audio upload failed: ${response.status} ${await response.text()}`);
  }

  return `${baseUrl}/storage/v1/object/public/${config.VOICE_AUDIO_BUCKET}/${path}`;
}

let bucketReady = false;

async function ensureSupabaseBucket(): Promise<void> {
  if (bucketReady) return;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return;

  const baseUrl = config.SUPABASE_URL.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: config.VOICE_AUDIO_BUCKET,
      name: config.VOICE_AUDIO_BUCKET,
      public: true,
      file_size_limit: 10 * 1024 * 1024,
      allowed_mime_types: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/opus"]
    })
  });

  if (!response.ok && response.status !== 409 && response.status !== 400) {
    throw new Error(`Supabase bucket check failed: ${response.status} ${await response.text()}`);
  }

  bucketReady = true;
}

function buildAudioPath(key: VoiceFlowCacheKey, mimeType: string): string {
  const extension = mimeType.includes("wav") ? "wav" : mimeType.includes("opus") ? "opus" : "mp3";
  return [
    "voice-flows",
    safePath(key.organizationId),
    safePath(key.userId),
    safePath(key.flowId),
    `v${key.flowVersion}`,
    safePath(key.voiceProfileId || "default"),
    safePath(getVoiceId(key) || getVoiceProvider(key)),
    `${safePath(key.nodeId)}-${key.chunkIndex}-${hashText(key.text).slice(0, 16)}.${extension}`
  ].join("/");
}

function getVoiceProvider(key: VoiceFlowCacheKey): string {
  return key.voiceProfileId ? "tenant" : config.TTS_PROVIDER;
}

function getVoiceId(key: VoiceFlowCacheKey): string {
  if (key.voiceProfileId) return key.voiceProfileId;
  return config.TTS_PROVIDER === "fish"
    ? config.FISH_AUDIO_REFERENCE_ID || config.FISH_AUDIO_MODEL
    : config.TTS_VOICE_ID;
}

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text.trim()).digest("hex");
}

function safePath(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "default";
}
