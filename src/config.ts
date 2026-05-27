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
  STT_PROVIDER: z.enum(["openai", "http"]).default("http"),
  STT_HTTP_URL: z.string().url().optional(),
  STT_HTTP_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_STT_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OPENAI_TRANSCRIPTIONS_URL: z.string().url().default("https://api.openai.com/v1/audio/transcriptions"),
  TTS_PROVIDER: z.enum(["fish", "http"]).default("http"),
  TTS_HTTP_URL: z.string().url().optional(),
  TTS_HTTP_API_KEY: z.string().optional(),
  TTS_VOICE_ID: z.string().default("default"),
  FISH_AUDIO_API_KEY: z.string().optional(),
  FISH_AUDIO_TTS_URL: z.string().url().default("https://api.fish.audio/v1/tts"),
  FISH_AUDIO_MODEL: z.enum(["s1", "s2", "s2-pro"]).default("s2"),
  FISH_AUDIO_REFERENCE_ID: z.string().optional(),
  FISH_AUDIO_FORMAT: z.enum(["mp3", "wav", "pcm", "opus"]).default("mp3"),
  FISH_AUDIO_SAMPLE_RATE: z.coerce.number().optional(),
  FISH_AUDIO_MP3_BITRATE: z.coerce.number().default(128),
  FISH_AUDIO_LATENCY: z.preprocess(
    (value) => value === "lowest" ? "low" : value,
    z.enum(["normal", "balanced", "low"]).default("low")
  ),
  FISH_AUDIO_TEMPERATURE: z.coerce.number().default(0.7),
  FISH_AUDIO_TOP_P: z.coerce.number().default(0.7),
  FISH_AUDIO_SPEED: z.coerce.number().default(1),
  FISH_AUDIO_VOLUME: z.coerce.number().default(0),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VALIDATE_SIGNATURE: z.coerce.boolean().default(false),
  ENABLE_STREAMING: z.coerce.boolean().default(true)
}).superRefine((env, ctx) => {
  if (env.STT_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENAI_API_KEY"],
      message: "OPENAI_API_KEY is required when STT_PROVIDER=openai"
    });
  }

  if (env.STT_PROVIDER === "http" && !env.STT_HTTP_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STT_HTTP_URL"],
      message: "STT_HTTP_URL is required when STT_PROVIDER=http"
    });
  }

  if (env.TTS_PROVIDER === "fish" && !env.FISH_AUDIO_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FISH_AUDIO_API_KEY"],
      message: "FISH_AUDIO_API_KEY is required when TTS_PROVIDER=fish"
    });
  }

  if (env.TTS_PROVIDER === "fish" && !env.FISH_AUDIO_REFERENCE_ID) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FISH_AUDIO_REFERENCE_ID"],
      message: "FISH_AUDIO_REFERENCE_ID is required when TTS_PROVIDER=fish"
    });
  }

  if (env.TTS_PROVIDER === "http" && !env.TTS_HTTP_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["TTS_HTTP_URL"],
      message: "TTS_HTTP_URL is required when TTS_PROVIDER=http"
    });
  }
});

export const config = envSchema.parse(process.env);
