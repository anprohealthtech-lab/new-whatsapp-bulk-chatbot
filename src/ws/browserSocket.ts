import type { WebSocket } from "ws";
import { config } from "../config.js";
import { processUtterance, processUtteranceStreaming } from "../services/conversationPipeline.js";
import { FlowRunner } from "../services/flowRunner.js";
import { transcribeSpeech } from "../services/stt.js";
import type { VoiceContext } from "../types.js";

interface BrowserClientMessage {
  type: "audio" | "audio_delta" | "audio_end" | "barge_in" | "start_flow" | "stop";
  audioBase64?: string;
  sequence?: number;
  mimeType?: string;
  sessionId?: string;
  organizationId?: string;
  userId?: string;
  flowId?: string;
}

export function handleBrowserSocket(ws: WebSocket): void {
  const bufferedAudioChunks: Array<{ sequence: number; buffer: Buffer }> = [];
  let bufferedContext: VoiceContext | null = null;
  let bufferedMimeType = "audio/webm;codecs=opus";
  let flowRunner: FlowRunner | null = null;
  let flowWaitingForInput = false;

  ws.on("message", async (raw) => {
    const requestStartedAt = Date.now();
    try {
      const message = JSON.parse(raw.toString()) as BrowserClientMessage;
      if (message.type === "barge_in" || message.type === "stop") {
        bufferedAudioChunks.length = 0;
        sendStatus(ws, "Stopped", "control");
        return;
      }

      const context: VoiceContext = {
        channel: "browser",
        sessionId: message.sessionId || crypto.randomUUID(),
        organizationId: message.organizationId || config.DEFAULT_ORGANIZATION_ID,
        userId: message.userId || config.DEFAULT_USER_ID
      };
      bufferedContext = context;
      bufferedMimeType = message.mimeType || bufferedMimeType;

      if (message.type === "start_flow") {
        flowRunner = new FlowRunner(message.flowId);
        flowWaitingForInput = false;
        sendStatus(ws, "Flow started", "flow", undefined, message.flowId || "health_camp_reminder");
        const result = await flowRunner.start(context, flowCallbacks(ws));
        flowWaitingForInput = result.status === "listening";
        if (flowWaitingForInput) {
          ws.send(JSON.stringify({ type: "flow_listen", nodeId: result.currentNodeId }));
        } else {
          ws.send(JSON.stringify({ type: "flow_end" }));
        }
        return;
      }

      if (message.type === "audio_delta") {
        if (!message.audioBase64) return;
        bufferedAudioChunks.push({
          sequence: typeof message.sequence === "number" ? message.sequence : bufferedAudioChunks.length,
          buffer: Buffer.from(message.audioBase64, "base64")
        });
        if (bufferedAudioChunks.length === 1 || bufferedAudioChunks.length % 8 === 0) {
          sendStatus(ws, "Listening", "receive", undefined, `${bufferedAudioChunks.length} chunks`);
        }
        return;
      }

      let audioBase64 = message.audioBase64;
      if (message.type === "audio_end") {
        if (message.audioBase64) {
          audioBase64 = message.audioBase64;
        } else if (bufferedAudioChunks.length) {
          const orderedChunks = bufferedAudioChunks
            .sort((a, b) => a.sequence - b.sequence)
            .map((chunk) => chunk.buffer);
          audioBase64 = Buffer.concat(orderedChunks).toString("base64");
        } else {
          sendStatus(ws, "No audio captured", "receive");
          return;
        }
        bufferedAudioChunks.length = 0;
      }

      if (message.type !== "audio" && message.type !== "audio_end") return;
      if (!audioBase64) return;

      const effectiveContext = bufferedContext || context;
      const effectiveMimeType = message.mimeType || bufferedMimeType;
      const audioBytes = Math.floor((audioBase64.length * 3) / 4);
      console.log(
        `[voice][browser] received audio session=${effectiveContext.sessionId} org=${effectiveContext.organizationId} user=${effectiveContext.userId} bytes=${audioBytes} mime=${effectiveMimeType || "unknown"}`
      );

      sendStatus(ws, "Received audio", "receive", 0, `${audioBytes} bytes`);

      if (flowRunner && flowWaitingForInput) {
        flowWaitingForInput = false;
        sendStatus(ws, "Flow transcribing", "flow");
        const transcript = await transcribeSpeech({
          audioBase64,
          encoding: "webm-opus",
          sampleRate: 48000,
          mimeType: effectiveMimeType,
          context: effectiveContext
        });
        ws.send(JSON.stringify({ type: "flow_transcript", transcript }));
        const result = await flowRunner.handleUserText(transcript, effectiveContext, flowCallbacks(ws));
        flowWaitingForInput = result.status === "listening";
        if (flowWaitingForInput) {
          ws.send(JSON.stringify({ type: "flow_listen", nodeId: result.currentNodeId }));
        } else {
          ws.send(JSON.stringify({ type: "flow_end" }));
        }
        return;
      }

      if (config.ENABLE_STREAMING) {
        const audioChunks: Array<{ audioBase64: string; mimeType: string }> = [];

        const result = await processUtteranceStreaming(
          {
            audioBase64,
            encoding: "webm-opus",
            sampleRate: 48000,
            mimeType: effectiveMimeType,
            context: effectiveContext
          },
          {
            onFirstAudio: (audio, sentence) => {
              sendStatus(ws, "First audio ready", "tts", Date.now() - requestStartedAt, "first sentence");
              const audioBase64 = audio.audioBase64;
              const audioUrl = audio.audioUrl;
              const mimeType = audio.mimeType || "audio/mpeg";
              ws.send(JSON.stringify({
                type: "audio_chunk",
                audioBase64,
                audioUrl,
                mimeType,
                sentence,
                index: 0
              }));
              audioChunks.push({ audioBase64: audioBase64 || "", mimeType });
            },
            onAudioChunk: (audio, sentence, index) => {
              const audioBase64 = audio.audioBase64;
              const audioUrl = audio.audioUrl;
              const mimeType = audio.mimeType || "audio/mpeg";
              ws.send(JSON.stringify({
                type: "audio_chunk",
                audioBase64,
                audioUrl,
                mimeType,
                sentence,
                index
              }));
              audioChunks.push({ audioBase64: audioBase64 || "", mimeType });
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
          audioBase64,
          encoding: "webm-opus",
          sampleRate: 48000,
          mimeType: effectiveMimeType,
          context: effectiveContext
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
      console.log(`[voice][browser] reply sent in ${Date.now() - requestStartedAt}ms session=${effectiveContext.sessionId}`);
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

function flowCallbacks(ws: WebSocket) {
  return {
    onAudio: ({ audio, text, index }: { audio: any; text: string; index: number }) => {
      ws.send(JSON.stringify({
        type: "audio_chunk",
        audioBase64: audio.audioBase64,
        audioUrl: audio.audioUrl,
        mimeType: audio.mimeType || "audio/mpeg",
        sentence: text,
        index
      }));
    },
    onStatus: (status: string, detail?: string) => {
      sendStatus(ws, status, "flow", undefined, detail);
    }
  };
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
