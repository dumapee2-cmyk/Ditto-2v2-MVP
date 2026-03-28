import { randomUUID } from "node:crypto";
import type {
  PipelineState,
  PipelineContext,
  StateHandler,
  StateTransition,
  GenerationConfig,
} from "./types.js";
import { DEFAULT_GENERATION_CONFIG } from "./types.js";
import type { ProgressCallback } from "../progressEmitter.js";

import { handleIntake } from "./handlers/intake.js";
import { handleResearch } from "./handlers/research.js";
import { handleReasoning } from "./handlers/reasoning.js";
import { handlePlanning } from "./handlers/planning.js";
import { handleGeneration } from "./handlers/generation.js";
import { handleValidation } from "./handlers/validation.js";
import { handleReview } from "./handlers/review.js";
import { handleFinalize } from "./handlers/finalize.js";

/* ------------------------------------------------------------------ */
/*  State → Handler mapping (deterministic — no LLM chooses next state) */
/* ------------------------------------------------------------------ */

const STATE_HANDLERS: Record<PipelineState, StateHandler | null> = {
  INTAKE:      handleIntake,
  RESEARCHING: handleResearch,
  REASONING:   handleReasoning,
  PLANNING:    handlePlanning,
  GENERATING:  handleGeneration,
  VALIDATING:  handleValidation,
  REVIEWING:   handleReview,
  FINALIZING:  handleFinalize,
  COMPLETE:    null,  // terminal
  FAILED:      null,  // terminal
};

const STATE_PROGRESS_LABEL: Partial<Record<PipelineState, string>> = {
  INTAKE: "Analyzing agent request...",
  RESEARCHING: "Researching domain...",
  REASONING: "Designing agent personality...",
  PLANNING: "Generating agent logic...",
  GENERATING: "Refining agent code...",
  VALIDATING: "Scoring agent quality...",
  REVIEWING: "Testing conversations...",
  FINALIZING: "Deploying agent...",
};

/* ------------------------------------------------------------------ */
/*  Create initial pipeline context                                     */
/* ------------------------------------------------------------------ */

export function createPipelineContext(
  prompt: string,
  model: "gemini",
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  config?: Partial<GenerationConfig>,
): PipelineContext {
  const mergedConfig: GenerationConfig = { ...DEFAULT_GENERATION_CONFIG, ...config };

  return {
    runId: randomUUID(),
    prompt,
    model,
    config: mergedConfig,
    state: "INTAKE",
    stateHistory: [],
    webSearchContext: null,
    documentContext: null,
    competitorContext: null,
    intent: null,
    agentSpec: null,
    agentCode: null,
    agentConfig: null,
    agentName: null,
    qualityScore: null,
    qualityBreakdown: null,
    pipelineArtifact: null,
    pipelineSummary: null,
    reviewResult: null,
    testResults: null,
    qualityRegenAttempt: 0,
    reviewRepairAttempt: 0,
    degraded: false,
    errors: [],
    onProgress,
    signal,
    result: null,
  };
}

/* ------------------------------------------------------------------ */
/*  State Machine Runner                                                */
/* ------------------------------------------------------------------ */

export async function runStateMachine(ctx: PipelineContext): Promise<PipelineContext> {
  const startTime = Date.now();

  const globalTimeoutMs = Number(process.env.BIT7_PIPELINE_TIMEOUT_MS) || 900_000; // 15 min default

  while (ctx.state !== "COMPLETE" && ctx.state !== "FAILED") {
    // Abort guard
    if (ctx.signal?.aborted) {
      console.log(`[Pipeline ${ctx.runId.slice(0, 8)}] Aborted (client disconnected)`);
      ctx.errors.push({
        state: ctx.state,
        message: "Pipeline cancelled — client disconnected",
        timestamp: Date.now(),
      });
      ctx.state = "FAILED";
      break;
    }

    // Global timeout guard
    if (Date.now() - startTime > globalTimeoutMs) {
      console.warn(`[Pipeline ${ctx.runId.slice(0, 8)}] Global timeout (${globalTimeoutMs}ms) exceeded`);
      ctx.errors.push({
        state: ctx.state,
        message: `Pipeline timed out after ${Math.round((Date.now() - startTime) / 1000)}s`,
        timestamp: Date.now(),
      });
      if (ctx.agentCode) {
        ctx.state = "FINALIZING";
        continue;
      } else {
        ctx.state = "FAILED";
        break;
      }
    }

    const handler = STATE_HANDLERS[ctx.state];
    if (!handler) {
      console.error(`No handler for state: ${ctx.state}`);
      ctx.state = "FAILED";
      ctx.errors.push({
        state: ctx.state,
        message: `No handler for state: ${ctx.state}`,
        timestamp: Date.now(),
      });
      break;
    }

    const stateStart = Date.now();
    ctx.stateHistory.push({ state: ctx.state, entered_at: stateStart });

    console.log(`[Pipeline ${ctx.runId.slice(0, 8)}] → ${ctx.state}`);
    const progressLabel = STATE_PROGRESS_LABEL[ctx.state];
    if (progressLabel) {
      ctx.onProgress?.({ type: "status", message: progressLabel });
    }

    let transition: StateTransition;
    try {
      transition = await handler(ctx);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[Pipeline ${ctx.runId.slice(0, 8)}] ${ctx.state} FAILED:`, errMsg);
      ctx.errors.push({
        state: ctx.state,
        message: errMsg,
        timestamp: Date.now(),
      });

      transition = { nextState: "FAILED" };
    }

    // Record duration for completed state
    const lastEntry = ctx.stateHistory[ctx.stateHistory.length - 1];
    if (lastEntry) {
      lastEntry.duration_ms = Date.now() - stateStart;
    }

    ctx.state = transition.nextState;
  }

  const totalDuration = Date.now() - startTime;
  console.log(
    `[Pipeline ${ctx.runId.slice(0, 8)}] ${ctx.state} in ${totalDuration}ms ` +
    `(${ctx.stateHistory.length} states)`,
  );

  return ctx;
}
