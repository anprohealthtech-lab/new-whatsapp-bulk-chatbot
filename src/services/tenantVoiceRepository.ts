import { requireDatabase, sql } from "../db.js";
import type {
  RuntimeCredential,
  RuntimeVoiceAgent,
  RuntimeVoiceProfile,
  VoiceContext
} from "../types.js";
import { decryptCredential, encryptCredential } from "./credentialCrypto.js";

interface CredentialRow {
  id: string;
  provider: RuntimeCredential["provider"];
  credential_type: RuntimeCredential["credentialType"];
  encrypted_secret: string;
  settings: Record<string, unknown> | null;
}

interface AgentRow {
  id: string;
  stt_credential_id: string | null;
  voice_profile_id: string | null;
}

interface ProfileRow {
  id: string;
  provider: RuntimeVoiceProfile["provider"];
  credential_id: string;
  reference_id: string | null;
  model: string | null;
  audio_format: RuntimeVoiceProfile["format"] | null;
  settings: Record<string, unknown> | null;
}

export async function saveEncryptedProviderCredential(input: {
  organizationId: string;
  userId: string;
  provider: RuntimeCredential["provider"];
  credentialType: RuntimeCredential["credentialType"];
  name: string;
  secret: string;
  settings?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const db = requireDatabase();
  const rows = await db<Array<{ id: string }>>`
    INSERT INTO voice_provider_credentials (
      organization_id, user_id, provider, credential_type, name,
      encrypted_secret, settings, status, updated_at
    ) VALUES (
      ${input.organizationId}, ${input.userId}, ${input.provider},
      ${input.credentialType}, ${input.name}, ${encryptCredential(input.secret)},
      ${JSON.stringify(input.settings || {})}, 'active', now()
    )
    RETURNING id
  `;
  return rows[0];
}

export async function rotateEncryptedProviderCredential(input: {
  organizationId: string;
  userId: string;
  credentialId: string;
  secret: string;
  settings?: Record<string, unknown>;
}): Promise<boolean> {
  const db = requireDatabase();
  const rows = await db<Array<{ id: string }>>`
    UPDATE voice_provider_credentials
    SET encrypted_secret = ${encryptCredential(input.secret)},
        settings = COALESCE(${input.settings ? JSON.stringify(input.settings) : null}::jsonb, settings),
        status = 'active',
        updated_at = now()
    WHERE id = ${input.credentialId}
      AND organization_id = ${input.organizationId}
      AND user_id = ${input.userId}
    RETURNING id
  `;
  return rows.length === 1;
}

export async function createVoiceProfile(input: {
  organizationId: string;
  userId: string;
  credentialId: string;
  name: string;
  provider: RuntimeVoiceProfile["provider"];
  referenceId?: string;
  model?: string;
  language?: string;
  audioFormat?: RuntimeVoiceProfile["format"];
  settings?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const db = requireDatabase();
  const credentials = await db<Array<{ id: string }>>`
    SELECT id FROM voice_provider_credentials
    WHERE id = ${input.credentialId}
      AND organization_id = ${input.organizationId}
      AND user_id = ${input.userId}
      AND credential_type = 'tts'
      AND status = 'active'
    LIMIT 1
  `;
  if (!credentials[0]) throw new Error("Active tenant TTS credential not found");

  const rows = await db<Array<{ id: string }>>`
    INSERT INTO voice_profiles (
      organization_id, user_id, credential_id, name, provider, reference_id,
      model, language, audio_format, settings, status, updated_at
    ) VALUES (
      ${input.organizationId}, ${input.userId}, ${input.credentialId}, ${input.name},
      ${input.provider}, ${input.referenceId || null}, ${input.model || null},
      ${input.language || null}, ${input.audioFormat || "mp3"},
      ${JSON.stringify(input.settings || {})}, 'active', now()
    )
    RETURNING id
  `;
  return rows[0];
}

export async function createVoiceAgent(input: {
  organizationId: string;
  userId: string;
  name: string;
  systemPrompt?: string;
  languageMode?: string;
  responseMode?: string;
  defaultFlowKey?: string;
  ragAgentId?: string;
  sttCredentialId?: string;
  voiceProfileId?: string;
}): Promise<{ id: string }> {
  const db = requireDatabase();
  const rows = await db<Array<{ id: string }>>`
    INSERT INTO voice_agents (
      organization_id, user_id, name, status, system_prompt, language_mode,
      response_mode, default_flow_key, rag_agent_id, stt_credential_id,
      voice_profile_id, updated_at
    ) VALUES (
      ${input.organizationId}, ${input.userId}, ${input.name}, 'active',
      ${input.systemPrompt || null}, ${input.languageMode || "match_speaker"},
      ${input.responseMode || "voice"}, ${input.defaultFlowKey || null},
      ${input.ragAgentId || null}, ${input.sttCredentialId || null},
      ${input.voiceProfileId || null}, now()
    )
    RETURNING id
  `;
  return rows[0];
}

export async function getRuntimeVoiceAgent(context: VoiceContext): Promise<RuntimeVoiceAgent | null> {
  if (!sql) return null;
  const db = requireDatabase();
  const rows = context.voiceAgentId
    ? await db<AgentRow[]>`
        SELECT id, stt_credential_id, voice_profile_id
        FROM voice_agents
        WHERE id = ${context.voiceAgentId}
          AND organization_id = ${context.organizationId}
          AND user_id = ${context.userId}
          AND status = 'active'
        LIMIT 1
      `
    : await db<AgentRow[]>`
        SELECT id, stt_credential_id, voice_profile_id
        FROM voice_agents
        WHERE organization_id = ${context.organizationId}
          AND user_id = ${context.userId}
          AND status = 'active'
        ORDER BY created_at
        LIMIT 1
      `;

  const agent = rows[0];
  if (!agent) return null;

  const [sttCredential, voiceProfile] = await Promise.all([
    agent.stt_credential_id
      ? getCredential(context, agent.stt_credential_id, "stt")
      : Promise.resolve(undefined),
    context.voiceProfileId || agent.voice_profile_id
      ? getVoiceProfile(context, context.voiceProfileId || agent.voice_profile_id!)
      : Promise.resolve(undefined)
  ]);

  return { id: agent.id, sttCredential, voiceProfile };
}

async function getCredential(
  context: VoiceContext,
  credentialId: string,
  credentialType: RuntimeCredential["credentialType"]
): Promise<RuntimeCredential | undefined> {
  const db = requireDatabase();
  const rows = await db<CredentialRow[]>`
    SELECT id, provider, credential_type, encrypted_secret, settings
    FROM voice_provider_credentials
    WHERE id = ${credentialId}
      AND organization_id = ${context.organizationId}
      AND user_id = ${context.userId}
      AND credential_type = ${credentialType}
      AND status = 'active'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    provider: row.provider,
    credentialType: row.credential_type,
    secret: decryptCredential(row.encrypted_secret),
    settings: row.settings || {}
  };
}

async function getVoiceProfile(
  context: VoiceContext,
  profileId: string
): Promise<RuntimeVoiceProfile | undefined> {
  const db = requireDatabase();
  const rows = await db<ProfileRow[]>`
    SELECT id, provider, credential_id, reference_id, model, audio_format, settings
    FROM voice_profiles
    WHERE id = ${profileId}
      AND organization_id = ${context.organizationId}
      AND user_id = ${context.userId}
      AND status = 'active'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return undefined;
  const credential = await getCredential(context, row.credential_id, "tts");
  if (!credential) {
    throw new Error(`Active TTS credential not found for voice profile ${profileId}`);
  }
  return {
    id: row.id,
    provider: row.provider,
    referenceId: row.reference_id || undefined,
    model: row.model || undefined,
    format: row.audio_format || undefined,
    settings: row.settings || {},
    credential
  };
}
