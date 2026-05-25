import { config } from "../config.js";
import type { SpeechToTextInput } from "../types.js";

export async function transcribeSpeech(input: SpeechToTextInput): Promise<string> {
  const response = await fetch(config.STT_HTTP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.STT_HTTP_API_KEY
        ? { authorization: `Bearer ${config.STT_HTTP_API_KEY}` }
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
