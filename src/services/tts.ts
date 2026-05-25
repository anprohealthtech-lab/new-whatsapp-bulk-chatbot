import { config } from "../config.js";
import type { TextToSpeechInput, TextToSpeechOutput } from "../types.js";

export async function synthesizeSpeech(
  input: TextToSpeechInput
): Promise<TextToSpeechOutput> {
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

  return (await response.json()) as TextToSpeechOutput;
}
