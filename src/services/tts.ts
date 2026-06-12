import { config } from "../config.js";
import type { RuntimeVoiceProfile, TextToSpeechInput, TextToSpeechOutput } from "../types.js";
import { getRuntimeVoiceAgent } from "./tenantVoiceRepository.js";

export async function synthesizeSpeech(
  input: TextToSpeechInput
): Promise<TextToSpeechOutput> {
  const runtimeAgent = await getRuntimeVoiceAgent(input.context);
  const profile = runtimeAgent?.voiceProfile;
  const provider = profile?.provider || config.TTS_PROVIDER;
  console.log(`[voice] Synthesizing speech with provider=${provider}`);

  if (provider === "fish") {
    return synthesizeWithFishAudio(input, profile);
  }

  const httpUrl = stringSetting(profile?.credential.settings, "url") || config.TTS_HTTP_URL;
  const httpApiKey = profile?.credential.secret || config.TTS_HTTP_API_KEY;
  const voiceId = stringSetting(profile?.settings, "voiceId") || profile?.referenceId || config.TTS_VOICE_ID;
  if (!httpUrl) {
    throw new Error("TTS_HTTP_URL is required when TTS_PROVIDER=http");
  }

  const response = await fetch(httpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(httpApiKey
        ? { authorization: `Bearer ${httpApiKey}` }
        : {})
    },
    body: JSON.stringify({
      text: input.text,
      voiceId,
      channel: input.context.channel,
      sessionId: input.context.sessionId,
      preferredFormats:
        input.context.channel === "twilio"
          ? ["mulaw-8000", "mp3"]
          : ["mp3", "wav", "webm"]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TTS failed: ${response.status} ${body}`);
  }

  const output = (await response.json()) as TextToSpeechOutput;
  console.log(
    `[voice] HTTP TTS returned audioBase64=${Boolean(output.audioBase64)} audioUrl=${Boolean(output.audioUrl)} twilioMulawBase64=${Boolean(output.twilioMulawBase64)}`
  );
  if (!output.audioBase64 && !output.audioUrl && !output.twilioMulawBase64) {
    throw new Error("TTS provider returned no playable audio");
  }
  return output;
}

async function synthesizeWithFishAudio(
  input: TextToSpeechInput,
  profile?: RuntimeVoiceProfile
): Promise<TextToSpeechOutput> {
  const apiKey = profile?.credential.secret || config.FISH_AUDIO_API_KEY;
  const referenceId = profile?.referenceId || config.FISH_AUDIO_REFERENCE_ID;
  const apiUrl = stringSetting(profile?.credential.settings, "url") || config.FISH_AUDIO_TTS_URL;
  const model = profile?.model || config.FISH_AUDIO_MODEL;
  const format = input.context.preferredAudioFormat || profile?.format || config.FISH_AUDIO_FORMAT;
  const temperature = numberSetting(profile?.settings, "temperature", config.FISH_AUDIO_TEMPERATURE);
  const topP = numberSetting(profile?.settings, "topP", config.FISH_AUDIO_TOP_P);
  const speed = numberSetting(profile?.settings, "speed", config.FISH_AUDIO_SPEED);
  const volume = numberSetting(profile?.settings, "volume", config.FISH_AUDIO_VOLUME);
  const sampleRate = input.context.preferredSampleRate ||
    optionalNumberSetting(profile?.settings, "sampleRate") ||
    config.FISH_AUDIO_SAMPLE_RATE;
  const bitrate = numberSetting(profile?.settings, "mp3Bitrate", config.FISH_AUDIO_MP3_BITRATE);
  const latency = stringSetting(profile?.settings, "latency") || config.FISH_AUDIO_LATENCY;

  if (!apiKey) {
    throw new Error("FISH_AUDIO_API_KEY is required when TTS_PROVIDER=fish");
  }
  if (!referenceId) {
    throw new Error("FISH_AUDIO_REFERENCE_ID is required when TTS_PROVIDER=fish");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "model": model
    },
    body: JSON.stringify({
      text: input.text,
      reference_id: referenceId,
      temperature,
      top_p: topP,
      prosody: {
        speed,
        volume,
        normalize_loudness: true
      },
      chunk_length: 300,
      normalize: true,
      format,
      sample_rate: sampleRate,
      mp3_bitrate: bitrate,
      latency,
      max_new_tokens: 1024,
      repetition_penalty: 1.2,
      min_chunk_length: 50,
      condition_on_previous_chunks: false,
      early_stop_threshold: 1
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fish Audio TTS failed: ${response.status} ${body}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const mimeType = getMimeType(format);
  console.log(`[voice] Fish Audio returned ${audioBuffer.length} bytes as ${mimeType}`);
  if (audioBuffer.length === 0) {
    throw new Error("Fish Audio returned empty audio");
  }

  return {
    audioBase64: audioBuffer.toString("base64"),
    mimeType
  };
}

function stringSetting(settings: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = settings?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumberSetting(settings: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = settings?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberSetting(
  settings: Record<string, unknown> | undefined,
  key: string,
  fallback: number
): number {
  return optionalNumberSetting(settings, key) ?? fallback;
}

function getMimeType(format: string): string {
  switch (format) {
    case "wav":
      return "audio/wav";
    case "opus":
      return "audio/ogg;codecs=opus";
    case "pcm":
      return "audio/L16";
    case "mp3":
    default:
      return "audio/mpeg";
  }
}
