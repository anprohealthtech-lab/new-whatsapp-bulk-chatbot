import { config } from "../config.js";
import type { TextToSpeechInput, TextToSpeechOutput } from "../types.js";

export async function synthesizeSpeech(
  input: TextToSpeechInput
): Promise<TextToSpeechOutput> {
  console.log(`[voice] Synthesizing speech with provider=${config.TTS_PROVIDER}`);

  if (config.TTS_PROVIDER === "fish") {
    return synthesizeWithFishAudio(input);
  }

  if (!config.TTS_HTTP_URL) {
    throw new Error("TTS_HTTP_URL is required when TTS_PROVIDER=http");
  }

  const response = await fetch(config.TTS_HTTP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.TTS_HTTP_API_KEY
        ? { authorization: `Bearer ${config.TTS_HTTP_API_KEY}` }
        : {})
    },
    body: JSON.stringify({
      text: input.text,
      voiceId: config.TTS_VOICE_ID,
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
  input: TextToSpeechInput
): Promise<TextToSpeechOutput> {
  if (!config.FISH_AUDIO_API_KEY) {
    throw new Error("FISH_AUDIO_API_KEY is required when TTS_PROVIDER=fish");
  }
  if (!config.FISH_AUDIO_REFERENCE_ID) {
    throw new Error("FISH_AUDIO_REFERENCE_ID is required when TTS_PROVIDER=fish");
  }

  const response = await fetch(config.FISH_AUDIO_TTS_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.FISH_AUDIO_API_KEY}`,
      "Content-Type": "application/json",
      "model": config.FISH_AUDIO_MODEL
    },
    body: JSON.stringify({
      text: input.text,
      reference_id: config.FISH_AUDIO_REFERENCE_ID,
      temperature: config.FISH_AUDIO_TEMPERATURE,
      top_p: config.FISH_AUDIO_TOP_P,
      prosody: {
        speed: config.FISH_AUDIO_SPEED,
        volume: config.FISH_AUDIO_VOLUME,
        normalize_loudness: true
      },
      chunk_length: 300,
      normalize: true,
      format: config.FISH_AUDIO_FORMAT,
      sample_rate: config.FISH_AUDIO_SAMPLE_RATE,
      mp3_bitrate: config.FISH_AUDIO_MP3_BITRATE,
      latency: config.FISH_AUDIO_LATENCY,
      max_new_tokens: 1024,
      repetition_penalty: 1.2,
      min_chunk_length: 50,
      condition_on_previous_chunks: true,
      early_stop_threshold: 1
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fish Audio TTS failed: ${response.status} ${body}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const mimeType = getMimeType(config.FISH_AUDIO_FORMAT);
  console.log(`[voice] Fish Audio returned ${audioBuffer.length} bytes as ${mimeType}`);
  if (audioBuffer.length === 0) {
    throw new Error("Fish Audio returned empty audio");
  }

  return {
    audioBase64: audioBuffer.toString("base64"),
    mimeType
  };
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
