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
  const transcript = await transcribeSpeech(input);
  if (!transcript) return null;

  const reply = await askPlatformAgent(transcript, input.context);
  const speech = await synthesizeSpeech({
    text: reply.text,
    context: input.context
  });

  return { transcript, reply, speech };
}
