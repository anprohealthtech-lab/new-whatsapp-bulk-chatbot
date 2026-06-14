export type AudioEncoding = "webm-opus" | "mulaw-8000" | "wav";

export interface VoiceContext {
  channel: "browser" | "twilio";
  sessionId: string;
  callerId?: string;
  organizationId: string;
  userId: string;
  voiceAgentId?: string;
  flowId?: string;
  flowVersion?: number;
  voiceProfileId?: string;
  campaignId?: string;
  contactId?: string;
  gatewayId?: string;
  preferredAudioFormat?: "mp3" | "wav" | "pcm" | "opus";
  preferredSampleRate?: number;
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

export interface RuntimeCredential {
  id: string;
  provider: "fish" | "openai" | "http";
  credentialType: "stt" | "tts";
  secret: string;
  settings: Record<string, unknown>;
}

export interface RuntimeVoiceProfile {
  id: string;
  provider: "fish" | "http";
  referenceId?: string;
  model?: string;
  format?: "mp3" | "wav" | "pcm" | "opus";
  settings: Record<string, unknown>;
  credential: RuntimeCredential;
}

export interface RuntimeVoiceAgent {
  id: string;
  sttCredential?: RuntimeCredential;
  voiceProfile?: RuntimeVoiceProfile;
}
