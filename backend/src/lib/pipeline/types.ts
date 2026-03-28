import type { AgentIntent } from "../../types/index.js";
import type { AgentSpec, AgentConfig, QualityBreakdown, PipelineRunArtifact, GenerateResult } from "../../types/index.js";
import type { ProgressCallback } from "../progressEmitter.js";

/* ------------------------------------------------------------------ */
/*  Pipeline States                                                     */
/* ------------------------------------------------------------------ */

export type PipelineState =
  | "INTAKE"
  | "RESEARCHING"
  | "REASONING"
  | "PLANNING"
  | "GENERATING"
  | "VALIDATING"
  | "REVIEWING"
  | "FINALIZING"
  | "COMPLETE"
  | "FAILED";

/* ------------------------------------------------------------------ */
/*  Generation Config — controls candidate count, gating, review        */
/* ------------------------------------------------------------------ */

export interface GenerationConfig {
  model: "gemini";
  /** Number of candidates to generate in parallel (1 = current, 3 = multi-candidate) */
  candidateCount: 1 | 2 | 3;
  /** Enable quality gate in validation (can reject and regen) */
  qualityGateEnabled: boolean;
  /** Enable simulated conversation review after validation */
  enableReview: boolean;
}

export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  model: "gemini",
  candidateCount: 3,
  qualityGateEnabled: true,
  enableReview: true,
};

export const REFINE_GENERATION_CONFIG: GenerationConfig = {
  model: "gemini",
  candidateCount: 1,
  qualityGateEnabled: false,
  enableReview: false,
};

/* ------------------------------------------------------------------ */
/*  Pipeline Context — accumulated artifacts across states              */
/* ------------------------------------------------------------------ */

export interface StateEntry {
  state: PipelineState;
  entered_at: number;
  duration_ms?: number;
}

export interface PipelineContext {
  // Identity
  runId: string;
  prompt: string;
  model: "gemini";

  // Generation config — controls pipeline behavior
  config: GenerationConfig;

  // Current state
  state: PipelineState;
  stateHistory: StateEntry[];

  // Research artifacts
  webSearchContext: string | null;
  documentContext: string | null;
  competitorContext: string | null;

  // Reasoning artifacts
  intent: AgentIntent | null;

  // Agent artifacts
  agentSpec: AgentSpec | null;
  agentCode: string | null;
  agentConfig: AgentConfig | null;
  agentName: string | null;

  // Quality artifacts — used for ship/no-ship gating
  qualityScore: number | null;
  qualityBreakdown: QualityBreakdown | null;
  pipelineArtifact: PipelineRunArtifact | null;
  pipelineSummary: string | null;

  // Review artifacts
  reviewResult: ReviewResult | null;
  testResults: TestResult[] | null;

  // Separate retry budgets — validation and review don't steal from each other
  /** Quality gate regen counter (VALIDATING → PLANNING loop, max 1) */
  qualityRegenAttempt: number;
  /** Review repair counter (REVIEWING targeted repair, max 1) */
  reviewRepairAttempt: number;

  // Degraded flag — set when LLM reasoner fails and fallback intent is used
  degraded: boolean;

  // Error tracking
  errors: Array<{ state: PipelineState; message: string; timestamp: number }>;

  // Callbacks
  onProgress?: ProgressCallback;

  // Cancellation
  signal?: AbortSignal;

  // Final result
  result: GenerateResult | null;
}

/* ------------------------------------------------------------------ */
/*  Quality Gate types                                                  */
/* ------------------------------------------------------------------ */

export interface QualityGateResult {
  passed: boolean;
  reasons: string[];
}

export interface ReviewIssue {
  severity: "critical" | "warning" | "info";
  category: "conversation" | "state" | "security" | "tool_integration" | "personality";
  message: string;
}

export interface ReviewResult {
  passed: boolean;
  issues: ReviewIssue[];
  criticalCount: number;
  warningCount: number;
}

export interface TestResult {
  input: string;
  expectedBehavior: string;
  actualResponse: string;
  passed: boolean;
  notes?: string;
}

/* ------------------------------------------------------------------ */
/*  State Handler interface                                             */
/* ------------------------------------------------------------------ */

export interface StateTransition {
  nextState: PipelineState;
}

export type StateHandler = (ctx: PipelineContext) => Promise<StateTransition>;
