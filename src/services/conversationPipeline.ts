import { askPlatformAgent } from "./platformAgent.js";
import { transcribeSpeech } from "./stt.js";
import { synthesizeSpeech } from "./tts.js";
import type {
  AgentReply,
  SpeechToTextInput,
  TextToSpeechOutput
} from "../types.js";

export interface PipelineResult {
  transcript: string;
  reply: AgentReply;
  speech: TextToSpeechOutput;
}

export interface PipelineStageEvent {
  stage: "stt" | "agent" | "tts" | "total";
  status: "started" | "completed" | "failed";
  elapsedMs?: number;
  detail?: string;
}

export async function processUtterance(
  input: SpeechToTextInput,
  onStage?: (event: PipelineStageEvent) => void
): Promise<PipelineResult | null> {
  const totalStartedAt = Date.now();
  let currentStage: PipelineStageEvent["stage"] = "stt";
  let currentStageStartedAt = totalStartedAt;

  const sttStartedAt = Date.now();
  currentStage = "stt";
  currentStageStartedAt = sttStartedAt;
  emitStage(onStage, { stage: "stt", status: "started" });

  try {
    const transcript = await transcribeSpeech(input);
    const sttElapsedMs = Date.now() - sttStartedAt;
    emitStage(onStage, {
      stage: "stt",
      status: "completed",
      elapsedMs: sttElapsedMs,
      detail: transcript ? `${transcript.length} chars` : "empty transcript"
    });
    console.log(`[voice] STT completed in ${sttElapsedMs}ms transcriptChars=${transcript.length}`);
    if (!transcript) return null;

    const agentStartedAt = Date.now();
    currentStage = "agent";
    currentStageStartedAt = agentStartedAt;
    emitStage(onStage, { stage: "agent", status: "started" });
    const reply = await askPlatformAgent(transcript, input.context);
    const agentElapsedMs = Date.now() - agentStartedAt;
    emitStage(onStage, {
      stage: "agent",
      status: "completed",
      elapsedMs: agentElapsedMs,
      detail: `${reply.text.length} chars`
    });
    console.log(`[voice] Platform agent completed in ${agentElapsedMs}ms replyChars=${reply.text.length}`);

    const ttsStartedAt = Date.now();
    currentStage = "tts";
    currentStageStartedAt = ttsStartedAt;
    emitStage(onStage, { stage: "tts", status: "started" });
    const speech = await synthesizeSpeech({
      text: reply.text,
      context: input.context
    });
    const ttsElapsedMs = Date.now() - ttsStartedAt;
    const ttsDetail = speech.audioBase64
      ? `base64Chars=${speech.audioBase64.length} mime=${speech.mimeType || "unknown"}`
      : speech.audioUrl
        ? "audioUrl=true"
        : speech.twilioMulawBase64
          ? `twilioMulawChars=${speech.twilioMulawBase64.length}`
          : "no audio";
    emitStage(onStage, {
      stage: "tts",
      status: "completed",
      elapsedMs: ttsElapsedMs,
      detail: ttsDetail
    });
    console.log(`[voice] TTS completed in ${ttsElapsedMs}ms ${ttsDetail}`);

    const totalElapsedMs = Date.now() - totalStartedAt;
    emitStage(onStage, { stage: "total", status: "completed", elapsedMs: totalElapsedMs });
    console.log(`[voice] Total utterance completed in ${totalElapsedMs}ms`);

    return { transcript, reply, speech };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    emitStage(onStage, {
      stage: currentStage,
      status: "failed",
      elapsedMs: Date.now() - currentStageStartedAt,
      detail: message
    });
    console.error(`[voice] ${currentStage} failed in ${Date.now() - currentStageStartedAt}ms: ${message}`);
    const totalElapsedMs = Date.now() - totalStartedAt;
    emitStage(onStage, { stage: "total", status: "failed", elapsedMs: totalElapsedMs, detail: message });
    console.error(`[voice] Pipeline failed after ${totalElapsedMs}ms: ${message}`);
    throw error;
  }
}

function emitStage(
  onStage: ((event: PipelineStageEvent) => void) | undefined,
  event: PipelineStageEvent
): void {
  onStage?.(event);
}
