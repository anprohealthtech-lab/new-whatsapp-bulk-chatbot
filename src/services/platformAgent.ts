import { config } from "../config.js";
import type { AgentReply, VoiceContext } from "../types.js";

export async function askPlatformAgent(
  text: string,
  context: VoiceContext
): Promise<AgentReply> {
  console.log(
    `[voice] Calling platform agent url=${config.PLATFORM_AGENT_URL} session=${context.sessionId} org=${context.organizationId} user=${context.userId} textChars=${text.length}`
  );

  const response = await fetch(config.PLATFORM_AGENT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-voice-agent-secret": config.PLATFORM_AGENT_SECRET
    },
    body: JSON.stringify({
      text,
      channel: context.channel,
      sessionId: context.sessionId,
      callerId: context.callerId,
      organizationId: context.organizationId,
      userId: context.userId
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[voice] Platform agent failed status=${response.status} body=${body}`);
    throw new Error(`Platform agent failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as Partial<AgentReply>;
  const replyText = typeof data.text === "string" ? data.text.trim() : "";
  if (!replyText) {
    throw new Error("Platform agent returned an empty reply");
  }

  return { text: replyText, metadata: data.metadata };
}

export interface StreamingAgentCallbacks {
  onSentence: (sentence: string, isFinal: boolean) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

export async function askPlatformAgentStreaming(
  text: string,
  context: VoiceContext,
  callbacks: StreamingAgentCallbacks
): Promise<void> {
  console.log(
    `[voice] Calling platform agent (streaming) url=${config.PLATFORM_AGENT_URL} session=${context.sessionId}`
  );

  const response = await fetch(config.PLATFORM_AGENT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-voice-agent-secret": config.PLATFORM_AGENT_SECRET
    },
    body: JSON.stringify({
      text,
      channel: context.channel,
      sessionId: context.sessionId,
      callerId: context.callerId,
      organizationId: context.organizationId,
      userId: context.userId,
      stream: true
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[voice] Platform agent streaming failed status=${response.status} body=${body}`);
    callbacks.onError(new Error(`Platform agent failed: ${response.status} ${body}`));
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError(new Error("No response body for streaming"));
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);

        try {
          const event = JSON.parse(data);
          if (event.type === "sentence") {
            callbacks.onSentence(event.text, event.isFinal || false);
          } else if (event.type === "done") {
            callbacks.onDone(event.fullText || "");
          } else if (event.type === "error") {
            callbacks.onError(new Error(event.message || "Unknown streaming error"));
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
