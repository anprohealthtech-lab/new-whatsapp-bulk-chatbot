export type AudioEncoding = "webm-opus" | "mulaw-8000";

export interface VoiceContext {
  channel: "browser" | "twilio";
  sessionId: string;
  callerId?: string;
  organizationId: string;
  userId: string;
}

export interface AgentReply {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface SpeechToTextInput {
  audioBase64: string;
  encoding: AudioEncoding;
  sampleRate: number;
  mimeType: string;
  context: VoiceContext;
}

export interface TextToSpeechInput {
  text: string;
  context: VoiceContext;
}

export interface TextToSpeechOutput {
  audioBase64?: string;
  mimeType?: string;
  audioUrl?: string;
  twilioMulawBase64?: string;
}
