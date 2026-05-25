import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8080),
  PUBLIC_BASE_URL: z.string().url().optional(),
  PLATFORM_AGENT_URL: z.string().url(),
  PLATFORM_AGENT_SECRET: z.string().min(1),
  DEFAULT_ORGANIZATION_ID: z.string().default("default_org"),
  DEFAULT_USER_ID: z.string().default("default_user"),
  STT_HTTP_URL: z.string().url(),
  STT_HTTP_API_KEY: z.string().optional(),
  TTS_HTTP_URL: z.string().url(),
  TTS_HTTP_API_KEY: z.string().optional(),
  TTS_VOICE_ID: z.string().default("default"),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VALIDATE_SIGNATURE: z.coerce.boolean().default(false)
});

export const config = envSchema.parse(process.env);
