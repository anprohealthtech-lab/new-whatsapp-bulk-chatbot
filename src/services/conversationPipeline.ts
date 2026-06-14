import { askPlatformAgent, askPlatformAgentStreaming } from "./platformAgent.js";
import { transcribeSpeech } from "./stt.js";
import { synthesizeSpeech } from "./tts.js";
import { config } from "../config.js";
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

export interface StreamingPipelineCallbacks {
  onFirstAudio?: (audio: TextToSpeechOutput, sentenceText: string) => void;
  onAudioChunk?: (audio: TextToSpeechOutput, sentenceText: string, index: number) => void;
  onStage?: (event: PipelineStageEvent) => void;
}

export interface StreamingPipelineResult {
  transcript: string;
  fullReplyText: string;
  allAudio: TextToSpeechOutput[];
  timeToFirstAudio: number;
  totalTime: number;
}

export async function processUtteranceStreaming(
  input: SpeechToTextInput,
  callbacks: StreamingPipelineCallbacks
): Promise<StreamingPipelineResult | null> {
  const totalStartedAt = Date.now();
  let timeToFirstAudio = 0;
  const { onStage } = callbacks;

  const sttStartedAt = Date.now();
  emitStage(onStage, { stage: "stt", status: "started" });

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

  const allAudio: TextToSpeechOutput[] = [];
  let fullReplyText = "";
  let sentenceIndex = 0;
  let firstAudioSent = false;
  let ttsStartedAt = 0;
  let fillerAudioSent = false;
  let nextAudioToEmit = 0;
  let ttsInFlight = 0;
  const audioResults = new Map<number, { audio: TextToSpeechOutput; text: string }>();
  const ttsTasks: Promise<void>[] = [];

  const sendAudio = (audio: TextToSpeechOutput, text: string, index: number): void => {
    if (!firstAudioSent) {
      firstAudioSent = true;
      timeToFirstAudio = Date.now() - totalStartedAt;
      console.log(`[voice] First audio ready in ${timeToFirstAudio}ms`);
      callbacks.onFirstAudio?.(audio, text);
      return;
    }

    callbacks.onAudioChunk?.(audio, text, index);
  };

  const fillerText = buildVoiceFiller(transcript);
  const fillerTask = config.ENABLE_VOICE_FILLER && fillerText
    ? (async () => {
      try {
        console.log(`[voice] Filler TTS: "${fillerText}"`);
        const audio = await synthesizeSpeech({
          text: fillerText,
          context: input.context
        });
        if (firstAudioSent) return;
        fillerAudioSent = true;
        sendAudio(audio, fillerText, -1);
      } catch (err) {
        console.error(`[voice] Filler TTS failed: ${err}`);
      }
    })()
    : Promise.resolve();
  void fillerTask;

  const agentStartedAt = Date.now();
  emitStage(onStage, { stage: "agent", status: "started" });

  const emitReadyAudio = () => {
    while (audioResults.has(nextAudioToEmit)) {
      const item = audioResults.get(nextAudioToEmit)!;
      audioResults.delete(nextAudioToEmit);
      allAudio[nextAudioToEmit] = item.audio;

      sendAudio(item.audio, item.text, nextAudioToEmit);
      nextAudioToEmit++;
    }
  };

  const startTts = (text: string, index: number) => {
    if (index === 0) {
      ttsStartedAt = Date.now();
      emitStage(onStage, { stage: "tts", status: "started" });
    }

    ttsInFlight++;
    const task = (async () => {
      try {
        console.log(`[voice] TTS for phrase ${index}: "${text.substring(0, 50)}..."`);
        const audio = await synthesizeSpeech({
          text,
          context: input.context
        });
        audioResults.set(index, { audio, text });
        emitReadyAudio();
      } catch (err) {
        console.error(`[voice] TTS failed for phrase ${index}: ${err}`);
      } finally {
        ttsInFlight--;
      }
    })();

    ttsTasks.push(task);
  };

  return new Promise((resolve, reject) => {
    askPlatformAgentStreaming(transcript, input.context, {
      onSentence: (sentence, isFinal) => {
        console.log(`[voice] Received phrase ${sentenceIndex} (final=${isFinal}): "${sentence.substring(0, 50)}..."`);
        startTts(sentence, sentenceIndex);
        sentenceIndex++;
      },
      onDone: async (fullText) => {
        fullReplyText = fullText;
        const agentElapsedMs = Date.now() - agentStartedAt;
        emitStage(onStage, {
          stage: "agent",
          status: "completed",
          elapsedMs: agentElapsedMs,
          detail: `${fullText.length} chars`
        });
        console.log(`[voice] Agent streaming completed in ${agentElapsedMs}ms`);

        while (ttsInFlight > 0) {
          await new Promise(r => setTimeout(r, 50));
        }
        await Promise.allSettled(ttsTasks);
        emitReadyAudio();

        const ttsElapsedMs = ttsStartedAt ? Date.now() - ttsStartedAt : 0;
        emitStage(onStage, {
          stage: "tts",
          status: "completed",
          elapsedMs: ttsElapsedMs,
          detail: `${allAudio.length} chunks`
        });

        const totalElapsedMs = Date.now() - totalStartedAt;
        emitStage(onStage, { stage: "total", status: "completed", elapsedMs: totalElapsedMs });
        console.log(`[voice] Streaming pipeline completed in ${totalElapsedMs}ms (first audio at ${timeToFirstAudio}ms)`);

        resolve({
          transcript,
          fullReplyText,
          allAudio,
          timeToFirstAudio,
          totalTime: totalElapsedMs
        });
      },
      onError: (error) => {
        console.error(`[voice] Agent streaming error: ${error.message}`);
        emitStage(onStage, {
          stage: "agent",
          status: "failed",
          elapsedMs: Date.now() - agentStartedAt,
          detail: error.message
        });
        reject(error);
      }
    });
  });
}

function buildVoiceFiller(transcript: string): string | null {
  const normalized = transcript.trim().replace(/[?.!,]+$/g, "");
  const lower = normalized.toLowerCase();
  const aboutMatch = lower.match(/\b(?:symptoms? of|causes? of|treatments? for|what is|what are)\s+(.{3,60})/);
  if (aboutMatch?.[1] && /^[\x00-\x7F\s]+$/.test(normalized)) {
    return `Okay, let me check ${aboutMatch[1].trim()} for you.`;
  }
  if (!isLikelyEnglish(normalized)) return null;

  if (/\b(appointment|book|schedule|slot|visit|consultation)\b/.test(lower)) {
    return "Sure, I will check appointment options.";
  }

  if (/\b(report|reports|result|results|lab result|test result)\b/.test(lower)) {
    return "Okay, I will look into the report details.";
  }

  if (/\b(price|pricing|cost|charge|charges|fee|fees|rate|rates)\b/.test(lower)) {
    return "Sure, I will check the pricing.";
  }

  if (/\b(location|address|where|timing|time|hours|open|closed|available|availability)\b/.test(lower)) {
    return "Okay, I will check availability and timing.";
  }

  return "Okay, let me check that for you.";
}

function isLikelyEnglish(text: string): boolean {
  if (!/^[\x00-\x7F\s]+$/.test(text)) return false;
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  if (!words.length) return false;
  const commonEnglish = new Set([
    "a", "an", "and", "are", "can", "do", "for", "hello", "help", "how", "i",
    "is", "my", "need", "of", "please", "the", "to", "want", "what", "when", "where", "with", "you",
  ]);
  const matches = words.filter((word) => commonEnglish.has(word)).length;
  return matches >= 2 && matches / words.length >= 0.25;
}

export function combineAudioOutputs(outputs: TextToSpeechOutput[]): TextToSpeechOutput | null {
  if (outputs.length === 0) return null;
  if (outputs.length === 1) return outputs[0];

  const base64Parts = outputs
    .filter(o => o.audioBase64)
    .map(o => Buffer.from(o.audioBase64!, "base64"));

  if (base64Parts.length === 0) return outputs[0];

  const combined = Buffer.concat(base64Parts);
  return {
    audioBase64: combined.toString("base64"),
    mimeType: outputs[0].mimeType
  };
}

function emitStage(
  onStage: ((event: PipelineStageEvent) => void) | undefined,
  event: PipelineStageEvent
): void {
  onStage?.(event);
}
