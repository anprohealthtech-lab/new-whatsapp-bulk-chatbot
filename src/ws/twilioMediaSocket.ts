import type { WebSocket } from "ws";
import { config } from "../config.js";
import { processUtterance } from "../services/conversationPipeline.js";
import type { VoiceContext } from "../types.js";

interface TwilioStartMessage {
  event: "start";
  start: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
  };
}

interface TwilioMediaMessage {
  event: "media";
  media: {
    payload: string;
  };
}

interface TwilioStopMessage {
  event: "stop";
}

type TwilioMessage = TwilioStartMessage | TwilioMediaMessage | TwilioStopMessage;

const UTTERANCE_FRAME_COUNT = 80;

export function handleTwilioMediaSocket(ws: WebSocket): void {
  let context: VoiceContext | null = null;
  let streamSid = "";
  let chunks: string[] = [];
  let busy = false;

  ws.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as TwilioMessage;

      if (message.event === "start") {
        streamSid = message.start.streamSid;
        const params = message.start.customParameters || {};
        context = {
          channel: "twilio",
          sessionId: message.start.callSid,
          callerId: params.callerId,
          organizationId: params.organizationId || config.DEFAULT_ORGANIZATION_ID,
          userId: params.userId || config.DEFAULT_USER_ID
        };
        return;
      }

      if (message.event === "stop") {
        chunks = [];
        return;
      }

      if (message.event !== "media" || !context || busy) return;

      chunks.push(message.media.payload);
      if (chunks.length < UTTERANCE_FRAME_COUNT) return;

      busy = true;
      const audioBase64 = Buffer.concat(
        chunks.map((chunk) => Buffer.from(chunk, "base64"))
      ).toString("base64");
      chunks = [];

      const result = await processUtterance({
        audioBase64,
        encoding: "mulaw-8000",
        sampleRate: 8000,
        mimeType: "audio/x-mulaw",
        context
      });

      if (result?.speech.twilioMulawBase64) {
        ws.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: result.speech.twilioMulawBase64 }
          })
        );
      } else if (result?.reply.text) {
        console.warn(
          "TTS response had no twilioMulawBase64. Twilio live playback requires 8k mulaw base64 audio."
        );
      }
    } catch (error) {
      console.error("Twilio media error", error);
    } finally {
      busy = false;
    }
  });
}
