/* ------------------------------------------------------------------ */
/*  Core Agent Types                                                    */
/* ------------------------------------------------------------------ */

export interface AgentSpec {
  schema_version: "1";
  name: string;
  description: string;
  personality: string;
  capabilities: AgentCapability[];
  input_types: InputType[];
  data_model: DataField[];
  example_conversations: ExampleConversation[];
  tools: AgentTool[];
  system_prompt: string;
  welcome_message: string;
}

export interface AgentCapability {
  name: string;
  description: string;
  trigger_phrases: string[];
}

export type InputType = "text" | "photo" | "location" | "audio";

export interface DataField {
  key: string;
  type: "string" | "number" | "boolean" | "json" | "string[]";
  description: string;
  default_value?: unknown;
}

export interface ExampleConversation {
  label: string;
  messages: Array<{ role: "user" | "agent"; content: string }>;
}

export interface AgentTool {
  name: string;
  type: "vision" | "web_search" | "api_call" | "calculation";
  description: string;
  config: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Agent Intent (output of reasoner)                                   */
/* ------------------------------------------------------------------ */

export interface AgentIntent {
  agent_name: string;
  domain: string;
  personality_brief: string;
  capabilities: AgentCapability[];
  input_types: InputType[];
  data_fields: DataField[];
  example_conversations: ExampleConversation[];
  tools_needed: string[];
  narrative?: string;
}

/* ------------------------------------------------------------------ */
/*  Agent Runtime Config                                                */
/* ------------------------------------------------------------------ */

export interface AgentConfig {
  runtime_model: string;
  vision_model: string;
  max_history_length: number;
  session_timeout_minutes: number;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  runtime_model: "gpt-4o-mini",
  vision_model: "gpt-4o",
  max_history_length: 50,
  session_timeout_minutes: 60,
};

/* ------------------------------------------------------------------ */
/*  Quality Scoring                                                     */
/* ------------------------------------------------------------------ */

export interface QualityBreakdown {
  conversation_flow: number;
  input_handling: number;
  response_quality: number;
  state_management: number;
  error_recovery: number;
  tool_integration: number;
  personality_consistency: number;
  security: number;
}

export type CandidateId = "safe" | "balanced" | "bold";

export interface PipelineRunArtifact {
  run_id: string;
  stages: string[];
  selected_candidate: CandidateId;
  candidates: Array<{
    id: CandidateId;
    quality_score: number;
    quality_breakdown: QualityBreakdown;
  }>;
  repaired: boolean;
}

/* ------------------------------------------------------------------ */
/*  Generation Result                                                   */
/* ------------------------------------------------------------------ */

export interface GenerateResult {
  id: string;
  short_id: string;
  name: string;
  description: string;
  spec: AgentSpec;
  generated_code?: string;
  agent_config?: AgentConfig;
  pipeline_run_id?: string;
  quality_score?: number;
  quality_breakdown?: QualityBreakdown;
  latest_pipeline_summary?: string;
  phone_number?: string;
}

/* ------------------------------------------------------------------ */
/*  Conversation Types                                                  */
/* ------------------------------------------------------------------ */

export interface ConversationMessage {
  id: string;
  agent_id: string;
  user_phone: string;
  role: "user" | "agent";
  content: string;
  media_url?: string;
  media_type?: string;
  created_at: Date;
}

export interface UserState {
  agent_id: string;
  user_phone: string;
  data: Record<string, unknown>;
  conversation_count: number;
  last_active: Date;
}

/* ------------------------------------------------------------------ */
/*  Twilio Types                                                        */
/* ------------------------------------------------------------------ */

export interface TwilioWebhookPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
}

/* ------------------------------------------------------------------ */
/*  List/Summary Types                                                  */
/* ------------------------------------------------------------------ */

export interface RecentAgent {
  id: string;
  short_id: string;
  name: string;
  description: string;
  phone_number?: string;
  active: boolean;
  created_at: string;
}
