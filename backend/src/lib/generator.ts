import type { GenerateResult } from "../types/index.js";
import type { ProgressCallback } from "./progressEmitter.js";
import type { GenerationConfig } from "./pipeline/types.js";
import { createPipelineContext, runStateMachine } from "./pipeline/index.js";

export async function generateFromPrompt(
  prompt: string,
  model: "auto" | "gemini" | "sonnet" | "opus" = "auto",
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  documentContext?: string | null,
  config?: Partial<GenerationConfig>,
): Promise<GenerateResult> {
  const resolvedModel: "gemini" = "gemini";

  const ctx = createPipelineContext(prompt, resolvedModel, onProgress, signal, config);
  if (documentContext) {
    ctx.documentContext = documentContext;
  }
  const result = await runStateMachine(ctx);

  if (result.state === "FAILED" || !result.result) {
    const lastError = result.errors[result.errors.length - 1];
    throw new Error(
      lastError?.message ?? "Pipeline failed without producing a result"
    );
  }

  return result.result;
}
