import { sql } from "./db.js";

export async function runMigrations(): Promise<void> {
  if (!sql) {
    console.log("[voice] No DATABASE_URL set, skipping voice cache migrations");
    return;
  }

  try {
    console.log("[voice] Running voice cache migrations...");
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "voice_flow_audio_chunks" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" text NOT NULL,
        "user_id" text NOT NULL,
        "flow_id" text NOT NULL,
        "flow_version" integer DEFAULT 1 NOT NULL,
        "voice_profile_id" text,
        "node_id" text NOT NULL,
        "chunk_index" integer NOT NULL,
        "text" text NOT NULL,
        "text_hash" text NOT NULL,
        "voice_provider" text NOT NULL,
        "voice_id" text,
        "audio_path" text NOT NULL,
        "audio_url" text NOT NULL,
        "mime_type" text DEFAULT 'audio/mpeg' NOT NULL,
        "byte_size" integer,
        "metadata" jsonb DEFAULT '{}'::jsonb,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );

      ALTER TABLE "voice_flow_audio_chunks"
        ADD COLUMN IF NOT EXISTS "flow_version" integer DEFAULT 1 NOT NULL;
      ALTER TABLE "voice_flow_audio_chunks"
        ADD COLUMN IF NOT EXISTS "voice_profile_id" text;

      DROP INDEX IF EXISTS "voice_flow_audio_chunks_unique";
      CREATE UNIQUE INDEX "voice_flow_audio_chunks_unique"
        ON "voice_flow_audio_chunks" (
          "organization_id",
          "user_id",
          "flow_id",
          "flow_version",
          COALESCE("voice_profile_id", ''),
          "node_id",
          "chunk_index",
          "text_hash",
          "voice_provider",
          COALESCE("voice_id", '')
        );

      CREATE INDEX IF NOT EXISTS "voice_flow_audio_chunks_lookup"
        ON "voice_flow_audio_chunks" ("organization_id", "user_id", "flow_id", "node_id");

      CREATE TABLE IF NOT EXISTS "voice_provider_credentials" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" text NOT NULL,
        "user_id" text NOT NULL,
        "provider" text NOT NULL,
        "credential_type" text NOT NULL,
        "name" text NOT NULL,
        "encrypted_secret" text NOT NULL,
        "account_id" text,
        "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "is_platform_managed" boolean DEFAULT false NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "last_verified_at" timestamp,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS "voice_provider_credentials_tenant"
        ON "voice_provider_credentials" ("organization_id", "user_id", "credential_type", "status");

      CREATE TABLE IF NOT EXISTS "voice_profiles" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" text NOT NULL,
        "user_id" text NOT NULL,
        "credential_id" varchar NOT NULL REFERENCES "voice_provider_credentials"("id") ON DELETE RESTRICT,
        "name" text NOT NULL,
        "provider" text NOT NULL,
        "reference_id" text,
        "model" text,
        "language" text,
        "audio_format" text DEFAULT 'mp3' NOT NULL,
        "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS "voice_profiles_tenant"
        ON "voice_profiles" ("organization_id", "user_id", "status");

      CREATE TABLE IF NOT EXISTS "voice_agents" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" text NOT NULL,
        "user_id" text NOT NULL,
        "name" text NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "system_prompt" text,
        "language_mode" text DEFAULT 'match_speaker' NOT NULL,
        "response_mode" text DEFAULT 'voice' NOT NULL,
        "default_flow_key" text,
        "rag_agent_id" varchar,
        "stt_credential_id" varchar REFERENCES "voice_provider_credentials"("id") ON DELETE SET NULL,
        "voice_profile_id" varchar REFERENCES "voice_profiles"("id") ON DELETE SET NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS "voice_agents_tenant"
        ON "voice_agents" ("organization_id", "user_id", "status");

      CREATE TABLE IF NOT EXISTS "voice_flows" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" text NOT NULL,
        "user_id" text NOT NULL,
        "voice_agent_id" varchar REFERENCES "voice_agents"("id") ON DELETE CASCADE,
        "flow_key" text NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "version" integer NOT NULL,
        "status" text DEFAULT 'draft' NOT NULL,
        "start_node" text NOT NULL,
        "definition" jsonb NOT NULL,
        "voice_profile_id" varchar REFERENCES "voice_profiles"("id") ON DELETE SET NULL,
        "published_at" timestamp,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "voice_flows_tenant_version"
        ON "voice_flows" ("organization_id", "user_id", "flow_key", "version");
      CREATE INDEX IF NOT EXISTS "voice_flows_published_lookup"
        ON "voice_flows" ("organization_id", "user_id", "flow_key", "status", "version" DESC);
    `);
    console.log("[voice] Voice cache migrations completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[voice] Voice cache migration failed: ${message}`);
  }
}
