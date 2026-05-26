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

export async function processUtterance(
  input: SpeechToTextInput
): Promise<PipelineResult | null> {
  const totalStartedAt = Date.now();

  const sttStartedAt = Date.now();
  const transcript = await transcribeSpeech(input);
  console.log(`[voice] STT completed in ${Date.now() - sttStartedAt}ms`);
  if (!transcript) return null;

  const agentStartedAt = Date.now();
  const reply = await askPlatformAgent(transcript, input.context);
  console.log(`[voice] Platform agent completed in ${Date.now() - agentStartedAt}ms`);

  const ttsStartedAt = Date.now();
  const speech = await synthesizeSpeech({
    text: reply.text,
    context: input.context
  });
  console.log(`[voice] TTS completed in ${Date.now() - ttsStartedAt}ms`);
  console.log(`[voice] Total utterance completed in ${Date.now() - totalStartedAt}ms`);

  return { transcript, reply, speech };
}
