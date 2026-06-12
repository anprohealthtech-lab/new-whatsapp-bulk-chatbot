import { config } from "../config.js";
import type { RuntimeCredential, SpeechToTextInput } from "../types.js";
import { getRuntimeVoiceAgent } from "./tenantVoiceRepository.js";

export async function transcribeSpeech(input: SpeechToTextInput): Promise<string> {
  const runtimeAgent = await getRuntimeVoiceAgent(input.context);
  const credential = runtimeAgent?.sttCredential;
  const provider = credential?.provider || config.STT_PROVIDER;

  if (provider === "openai") {
    return transcribeWithOpenAI(input, credential);
  }

  const httpUrl = stringSetting(credential?.settings, "url") || config.STT_HTTP_URL;
  const apiKey = credential?.secret || config.STT_HTTP_API_KEY;
  if (!httpUrl) {
    throw new Error("STT_HTTP_URL is required when STT_PROVIDER=http");
  }

  const response = await fetch(httpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey
        ? { authorization: `Bearer ${apiKey}` }
        : {})
    },
    body: JSON.stringify({
      audioBase64: input.audioBase64,
      encoding: input.encoding,
      sampleRate: input.sampleRate,
      mimeType: input.mimeType,
      sessionId: input.context.sessionId,
      callerId: input.context.callerId
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`STT failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { text?: unknown };
  return typeof data.text === "string" ? data.text.trim() : "";
}

async function transcribeWithOpenAI(
  input: SpeechToTextInput,
  credential?: RuntimeCredential
): Promise<string> {
  const apiKey = credential?.secret || config.OPENAI_API_KEY;
  const model = stringSetting(credential?.settings, "model") || config.OPENAI_STT_MODEL;
  const url = stringSetting(credential?.settings, "url") || config.OPENAI_TRANSCRIPTIONS_URL;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when STT_PROVIDER=openai");
  }

  const audio = buildOpenAIAudioFile(input);
  const form = new FormData();
  form.append("model", model);
  form.append("response_format", "json");
  form.append("file", audio.blob, audio.filename);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI STT failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { text?: unknown };
  return typeof data.text === "string" ? data.text.trim() : "";
}

function stringSetting(settings: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = settings?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildOpenAIAudioFile(input: SpeechToTextInput): { blob: Blob; filename: string } {
  const audio = Buffer.from(input.audioBase64, "base64");
  if (audio.length < 1024) {
    throw new Error("Audio recording is too short to transcribe");
  }

  if (input.encoding === "mulaw-8000") {
    const wav = wrapMulawAsWav(audio, input.sampleRate || 8000);
    return {
      blob: new Blob([toBlobPart(wav)], { type: "audio/wav" }),
      filename: "twilio-audio.wav"
    };
  }

  const mimeType = input.mimeType || "audio/webm";
  return {
    blob: new Blob([toBlobPart(audio)], { type: mimeType }),
    filename: `browser-audio.${extensionForMimeType(mimeType)}`
  };
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function toBlobPart(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer);
}

function wrapMulawAsWav(payload: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(58);
  const dataSize = payload.length;
  const riffSize = 50 + dataSize;
  const byteRate = sampleRate;
  const blockAlign = 1;

  header.write("RIFF", 0);
  header.writeUInt32LE(riffSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(18, 16);
  header.writeUInt16LE(7, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(8, 34);
  header.writeUInt16LE(0, 36);
  header.write("fact", 38);
  header.writeUInt32LE(4, 42);
  header.writeUInt32LE(dataSize, 46);
  header.write("data", 50);
  header.writeUInt32LE(dataSize, 54);

  return Buffer.concat([header, payload]);
}
