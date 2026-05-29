import { synthesizeSpeech } from "./tts.js";
import { getOrCreateFlowAudioChunk, isVoiceCacheConfigured } from "./voiceFlowAudioCache.js";
import type { TextToSpeechOutput, VoiceContext } from "../types.js";

type FlowIntent = "yes" | "no" | "stop" | "repeat" | "question" | "unclear";
type FlowNodeType = "speak" | "listen" | "end";

export interface BaseFlowNode {
  id: string;
  type: FlowNodeType;
}

export interface SpeakFlowNode extends BaseFlowNode {
  type: "speak";
  text: string;
  next?: string;
}

export interface ListenFlowNode extends BaseFlowNode {
  type: "listen";
  prompt: string;
  intents: Partial<Record<FlowIntent, string>>;
}

export interface EndFlowNode extends BaseFlowNode {
  type: "end";
}

export type FlowNode = SpeakFlowNode | ListenFlowNode | EndFlowNode;

export interface VoiceFlow {
  id: string;
  startNode: string;
  nodes: Record<string, FlowNode>;
}

export interface FlowAudioChunk {
  audio: TextToSpeechOutput;
  text: string;
  index: number;
}

export interface FlowRunResult {
  status: "listening" | "ended";
  currentNodeId?: string;
}

export interface FlowRunnerCallbacks {
  onAudio: (chunk: FlowAudioChunk) => void;
  onStatus?: (status: string, detail?: string) => void;
}

export const sampleFlows: Record<string, VoiceFlow> = {
  health_camp_reminder: {
    id: "health_camp_reminder",
    startNode: "greeting",
    nodes: {
      greeting: {
        id: "greeting",
        type: "speak",
        text: "Hi, this is ANPRO. I am calling about your health camp registration.",
        next: "camp_info"
      },
      camp_info: {
        id: "camp_info",
        type: "speak",
        text: "The camp is on 24th at 10 AM.",
        next: "confirm"
      },
      confirm: {
        id: "confirm",
        type: "listen",
        prompt: "Would you like me to confirm your appointment?",
        intents: {
          yes: "confirmed",
          no: "not_confirmed",
          stop: "stop",
          repeat: "camp_info",
          question: "answer_question",
          unclear: "clarify"
        }
      },
      confirmed: {
        id: "confirmed",
        type: "speak",
        text: "Great, your appointment is confirmed for 24th at 10 AM. Thank you.",
        next: "end"
      },
      not_confirmed: {
        id: "not_confirmed",
        type: "speak",
        text: "No problem. We will not confirm it now. Thank you.",
        next: "end"
      },
      answer_question: {
        id: "answer_question",
        type: "speak",
        text: "The health camp is scheduled on 24th at 10 AM. Our team can help with registration and basic health checks.",
        next: "confirm"
      },
      clarify: {
        id: "clarify",
        type: "speak",
        text: "Sorry, I did not catch that.",
        next: "confirm"
      },
      stop: {
        id: "stop",
        type: "speak",
        text: "Okay, I will stop here. Thank you.",
        next: "end"
      },
      end: {
        id: "end",
        type: "end"
      }
    }
  }
};

export class FlowRunner {
  private flow: VoiceFlow;
  private currentNodeId: string;
  private audioIndex = 0;
  private lastListenNodeId: string | null = null;

  constructor(flowId = "health_camp_reminder") {
    const flow = sampleFlows[flowId];
    if (!flow) throw new Error(`Unknown voice flow: ${flowId}`);
    this.flow = flow;
    this.currentNodeId = flow.startNode;
  }

  async start(context: VoiceContext, callbacks: FlowRunnerCallbacks): Promise<FlowRunResult> {
    return this.runFromCurrentNode(context, callbacks);
  }

  async handleUserText(
    text: string,
    context: VoiceContext,
    callbacks: FlowRunnerCallbacks
  ): Promise<FlowRunResult> {
    const listenNode = this.getCurrentNode();
    if (listenNode.type !== "listen") {
      return { status: "ended" };
    }

    const intent = classifyFlowIntent(text);
    callbacks.onStatus?.("Flow intent", `${intent}: ${text}`);
    const nextNodeId = listenNode.intents[intent] || listenNode.intents.unclear;
    if (!nextNodeId) return { status: "ended" };

    this.currentNodeId = nextNodeId;
    return this.runFromCurrentNode(context, callbacks);
  }

  private async runFromCurrentNode(
    context: VoiceContext,
    callbacks: FlowRunnerCallbacks
  ): Promise<FlowRunResult> {
    while (true) {
      const node = this.getCurrentNode();

      if (node.type === "end") {
        callbacks.onStatus?.("Flow ended");
        return { status: "ended" };
      }

      if (node.type === "listen") {
        this.lastListenNodeId = node.id;
      await this.speak(node.prompt, node.id, context, callbacks);
        callbacks.onStatus?.("Flow listening", node.id);
        return { status: "listening", currentNodeId: node.id };
      }

      callbacks.onStatus?.("Flow speaking", node.id);
      await this.speak(node.text, node.id, context, callbacks);
      if (!node.next) return { status: "ended" };
      this.currentNodeId = node.next;
    }
  }

  private async speak(
    text: string,
    nodeId: string,
    context: VoiceContext,
    callbacks: FlowRunnerCallbacks
  ): Promise<void> {
    const phrases = splitIntoVoicePhrases(text);
    const chunks = await Promise.all(phrases.map(async (phrase, chunkIndex) => {
      if (isVoiceCacheConfigured()) {
        return getOrCreateFlowAudioChunk({
          organizationId: context.organizationId,
          userId: context.userId,
          flowId: this.flow.id,
          nodeId,
          chunkIndex,
          text: phrase
        }, context);
      }

      return {
        text: phrase,
        index: chunkIndex,
        cached: false,
        audio: await synthesizeSpeech({ text: phrase, context })
      };
    }));

    for (const chunk of chunks) {
      callbacks.onAudio({
        audio: chunk.audio,
        text: chunk.text,
        index: this.audioIndex++
      });
    }
  }

  private getCurrentNode(): FlowNode {
    const node = this.flow.nodes[this.currentNodeId || this.lastListenNodeId || this.flow.startNode];
    if (!node) throw new Error(`Voice flow node not found: ${this.currentNodeId}`);
    return node;
  }
}

export function getVoiceFlow(flowId: string): VoiceFlow | undefined {
  return sampleFlows[flowId];
}

export function listVoiceFlows(): Array<{ id: string; nodeCount: number }> {
  return Object.values(sampleFlows).map((flow) => ({
    id: flow.id,
    nodeCount: Object.keys(flow.nodes).length
  }));
}

function classifyFlowIntent(text: string): FlowIntent {
  const lower = text.toLowerCase();

  if (/\b(stop|bye|end|cancel|don't call|do not call|bas|ruk|band)\b/.test(lower)) return "stop";
  if (/\b(repeat|again|say again|pardon|dobara|phirse)\b/.test(lower)) return "repeat";
  if (/\b(yes|yeah|yep|ok|okay|confirm|sure|haan|ha|yes please)\b/.test(lower)) return "yes";
  if (/\b(no|nope|not now|later|nahi|mat)\b/.test(lower)) return "no";
  if (/\b(what|when|where|why|how|time|date|location|address|camp|details?)\b/.test(lower)) return "question";

  return "unclear";
}

export function splitIntoVoicePhrases(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?।])\s+/)
    .flatMap((part) => part.length > 90 ? part.split(/,\s+/) : [part])
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length ? parts : [text];
}
