import type { WebSocket } from "ws";
import { config } from "../config.js";
import { processUtterance, processUtteranceStreaming, combineAudioOutputs } from "../services/conversationPipeline.js";
import type { VoiceContext, TextToSpeechOutput } from "../types.js";

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

  const sendAudio = (audio: TextToSpeechOutput) => {
    if (audio?.twilioMulawBase64) {
      ws.send(
        JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: audio.twilioMulawBase64 }
        })
      );
    }
  };

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

      if (config.ENABLE_STREAMING) {
        const result = await processUtteranceStreaming(
          {
            audioBase64,
            encoding: "mulaw-8000",
            sampleRate: 8000,
            mimeType: "audio/x-mulaw",
            context
          },
          {
            onFirstAudio: (audio, sentence) => {
              console.log(`[twilio] Sending first audio for: "${sentence.substring(0, 30)}..."`);
              sendAudio(audio);
            },
            onAudioChunk: (audio, sentence, index) => {
              console.log(`[twilio] Sending audio chunk ${index} for: "${sentence.substring(0, 30)}..."`);
              sendAudio(audio);
            }
          }
        );

        if (!result) {
          console.log("[twilio] No transcript from streaming pipeline");
        }
      } else {
        const result = await processUtterance({
          audioBase64,
          encoding: "mulaw-8000",
          sampleRate: 8000,
          mimeType: "audio/x-mulaw",
          context
        });

        if (result?.speech.twilioMulawBase64) {
          sendAudio(result.speech);
        } else if (result?.reply.text) {
          console.warn(
            "TTS response had no twilioMulawBase64. Twilio live playback requires 8k mulaw base64 audio."
          );
        }
      }
    } catch (error) {
      console.error("Twilio media error", error);
    } finally {
      busy = false;
    }
  });
}
