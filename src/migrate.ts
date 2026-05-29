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

      CREATE UNIQUE INDEX IF NOT EXISTS "voice_flow_audio_chunks_unique"
        ON "voice_flow_audio_chunks" (
          "organization_id",
          "user_id",
          "flow_id",
          "node_id",
          "chunk_index",
          "text_hash",
          "voice_provider",
          COALESCE("voice_id", '')
        );

      CREATE INDEX IF NOT EXISTS "voice_flow_audio_chunks_lookup"
        ON "voice_flow_audio_chunks" ("organization_id", "user_id", "flow_id", "node_id");
    `);
    console.log("[voice] Voice cache migrations completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[voice] Voice cache migration failed: ${message}`);
  }
}
