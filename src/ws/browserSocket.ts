import type { WebSocket } from "ws";
import { config } from "../config.js";
import { processUtterance, processUtteranceStreaming } from "../services/conversationPipeline.js";
import type { VoiceContext } from "../types.js";

interface BrowserClientMessage {
  type: "audio" | "stop";
  audioBase64?: string;
  mimeType?: string;
  sessionId?: string;
  organizationId?: string;
  userId?: string;
}

export function handleBrowserSocket(ws: WebSocket): void {
  ws.on("message", async (raw) => {
    const requestStartedAt = Date.now();
    try {
      const message = JSON.parse(raw.toString()) as BrowserClientMessage;
      if (message.type !== "audio" || !message.audioBase64) return;

      const context: VoiceContext = {
        channel: "browser",
        sessionId: message.sessionId || crypto.randomUUID(),
        organizationId: message.organizationId || config.DEFAULT_ORGANIZATION_ID,
        userId: message.userId || config.DEFAULT_USER_ID
      };

      const audioBytes = Math.floor((message.audioBase64.length * 3) / 4);
      console.log(
        `[voice][browser] received audio session=${context.sessionId} org=${context.organizationId} user=${context.userId} bytes=${audioBytes} mime=${message.mimeType || "unknown"}`
      );

      sendStatus(ws, "Received audio", "receive", 0, `${audioBytes} bytes`);

      if (config.ENABLE_STREAMING) {
        const audioChunks: Array<{ audioBase64: string; mimeType: string }> = [];

        const result = await processUtteranceStreaming(
          {
            audioBase64: message.audioBase64,
            encoding: "webm-opus",
            sampleRate: 48000,
            mimeType: message.mimeType || "audio/webm;codecs=opus",
            context
          },
          {
            onFirstAudio: (audio, sentence) => {
              sendStatus(ws, "First audio ready", "tts", Date.now() - requestStartedAt, "first sentence");
              const audioBase64 = audio.audioBase64 || "";
              const mimeType = audio.mimeType || "audio/mpeg";
              ws.send(JSON.stringify({
                type: "audio_chunk",
                audioBase64,
                mimeType,
                sentence,
                index: 0
              }));
              audioChunks.push({ audioBase64, mimeType });
            },
            onAudioChunk: (audio, sentence, index) => {
              const audioBase64 = audio.audioBase64 || "";
              const mimeType = audio.mimeType || "audio/mpeg";
              ws.send(JSON.stringify({
                type: "audio_chunk",
                audioBase64,
                mimeType,
                sentence,
                index
              }));
              audioChunks.push({ audioBase64, mimeType });
            },
            onStage: (event) => {
              const statusText = formatStageStatus(event.stage, event.status);
              sendStatus(ws, statusText, event.stage, event.elapsedMs, event.detail);
            }
          }
        );

        if (!result) {
          sendStatus(ws, "No speech detected", "stt", Date.now() - requestStartedAt);
          return;
        }

        sendStatus(ws, "Sending reply", "reply", Date.now() - requestStartedAt);
        ws.send(JSON.stringify({
          type: "reply",
          transcript: result.transcript,
          text: result.fullReplyText,
          streaming: true,
          chunkCount: audioChunks.length
        }));
      } else {
        const result = await processUtterance({
          audioBase64: message.audioBase64,
          encoding: "webm-opus",
          sampleRate: 48000,
          mimeType: message.mimeType || "audio/webm;codecs=opus",
          context
        }, (event) => {
          const statusText = formatStageStatus(event.stage, event.status);
          sendStatus(ws, statusText, event.stage, event.elapsedMs, event.detail);
        });

        if (!result) {
          sendStatus(ws, "No speech detected", "stt", Date.now() - requestStartedAt);
          return;
        }

        sendStatus(ws, "Sending reply", "reply", Date.now() - requestStartedAt);
        ws.send(
          JSON.stringify({
            type: "reply",
            transcript: result.transcript,
            text: result.reply.text,
            audioBase64: result.speech.audioBase64,
            audioUrl: result.speech.audioUrl,
            mimeType: result.speech.mimeType
          })
        );
      }
      console.log(`[voice][browser] reply sent in ${Date.now() - requestStartedAt}ms session=${context.sessionId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[voice][browser] request failed in ${Date.now() - requestStartedAt}ms: ${message}`);
      ws.send(
        JSON.stringify({
          type: "error",
          error: message
        })
      );
    }
  });
}

function sendStatus(
  ws: WebSocket,
  status: string,
  stage: string,
  elapsedMs?: number,
  detail?: string
): void {
  ws.send(JSON.stringify({ type: "status", status, stage, elapsedMs, detail }));
}

function formatStageStatus(stage: string, status: string): string {
  const label = stage === "stt"
    ? "Transcription"
    : stage === "agent"
      ? "Agent"
      : stage === "tts"
        ? "TTS"
        : "Total";

  if (status === "started") return `${label} started`;
  if (status === "completed") return `${label} completed`;
  return `${label} failed`;
}
