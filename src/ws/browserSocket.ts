import type { WebSocket } from "ws";
import { config } from "../config.js";
import { processUtterance } from "../services/conversationPipeline.js";
import type { VoiceContext } from "../types.js";

interface BrowserClientMessage {
  type: "audio" | "stop";
  audioBase64?: string;
  sessionId?: string;
  organizationId?: string;
  userId?: string;
}

export function handleBrowserSocket(ws: WebSocket): void {
  ws.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as BrowserClientMessage;
      if (message.type !== "audio" || !message.audioBase64) return;

      const context: VoiceContext = {
        channel: "browser",
        sessionId: message.sessionId || crypto.randomUUID(),
        organizationId: message.organizationId || config.DEFAULT_ORGANIZATION_ID,
        userId: message.userId || config.DEFAULT_USER_ID
      };

      ws.send(JSON.stringify({ type: "status", status: "thinking" }));

      const result = await processUtterance({
        audioBase64: message.audioBase64,
        encoding: "webm-opus",
        sampleRate: 48000,
        mimeType: "audio/webm;codecs=opus",
        context
      });

      if (!result) {
        ws.send(JSON.stringify({ type: "status", status: "no_speech" }));
        return;
      }

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
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );
    }
  });
}
