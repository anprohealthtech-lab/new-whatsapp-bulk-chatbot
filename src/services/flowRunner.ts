import { synthesizeSpeech } from "./tts.js";
import { getOrCreateFlowAudioChunk, isVoiceCacheConfigured } from "./voiceFlowAudioCache.js";
import { getPublishedVoiceFlow } from "./flowRepository.js";
import { askPlatformAgent } from "./platformAgent.js";
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

export class FlowRunner {
  private flow: VoiceFlow;
  private flowVersion: number;
  private voiceProfileId?: string;
  private currentNodeId: string;
  private audioIndex = 0;
  private lastListenNodeId: string | null = null;

  private constructor(flow: VoiceFlow, flowVersion: number, voiceProfileId?: string) {
    this.flow = flow;
    this.flowVersion = flowVersion;
    this.voiceProfileId = voiceProfileId;
    this.currentNodeId = flow.startNode;
  }

  static async create(context: VoiceContext, flowId: string): Promise<FlowRunner> {
    const published = await getPublishedVoiceFlow(context, flowId, context.flowVersion);
    return new FlowRunner(published.flow, published.version, published.voiceProfileId);
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

    if (nextNodeId === listenNode.id && intent !== "stop") {
      callbacks.onStatus?.("Agent thinking");
      const reply = await askPlatformAgent(text, context);
      await this.speak(reply.text, `${listenNode.id}_agent`, context, callbacks);
      callbacks.onStatus?.("Flow listening", listenNode.id);
      return { status: "listening", currentNodeId: listenNode.id };
    }

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
    const runtimeContext: VoiceContext = {
      ...context,
      flowId: this.flow.id,
      flowVersion: this.flowVersion,
      voiceProfileId: this.voiceProfileId || context.voiceProfileId
    };
    const phrases = splitIntoVoicePhrases(text);
    const chunks = await Promise.all(phrases.map(async (phrase, chunkIndex) => {
      if (isVoiceCacheConfigured()) {
        return getOrCreateFlowAudioChunk({
          organizationId: context.organizationId,
          userId: context.userId,
          flowId: this.flow.id,
          flowVersion: this.flowVersion,
          voiceProfileId: runtimeContext.voiceProfileId,
          nodeId,
          chunkIndex,
          text: phrase
        }, runtimeContext);
      }

      return {
        text: phrase,
        index: chunkIndex,
        cached: false,
        audio: await synthesizeSpeech({ text: phrase, context: runtimeContext })
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
