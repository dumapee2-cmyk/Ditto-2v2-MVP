import { recordSpend, calculateCost } from "../../costTracker.js";
import { getUnifiedClient } from "../../unifiedClient.js";

export type IntentClass = "build_new" | "modify_existing" | "ambiguous" | "out_of_scope";

export interface ClassifiedIntent {
  classification: IntentClass;
  confidence: number;
  constraints: string[];
  refined_prompt?: string;
  rejection_reason?: string;
}

const CLASSIFIER_SYSTEM = `You are a prompt classifier for an SMS agent builder. Given a user prompt, classify it and extract constraints.

Respond with JSON only:
{
  "classification": "build_new" | "modify_existing" | "ambiguous" | "out_of_scope",
  "confidence": 0.0-1.0,
  "constraints": ["constraint1", "constraint2"],
  "refined_prompt": "optional clarified version",
  "rejection_reason": "only if out_of_scope"
}

Classification rules:
- "build_new": User wants to create a new SMS agent. Clear enough to proceed. Examples: "Build a calorie tracking SMS bot", "Create an SMS agent that logs workouts", "Make a text-based recipe assistant"
- "modify_existing": User references an existing agent or wants changes. Examples: "Add photo recognition to my agent", "Change the personality to be more friendly"
- "ambiguous": Too vague to build anything useful. Examples: "make a bot", "something cool", just a single word
- "out_of_scope": Not an agent/bot request at all. Examples: "What's the weather?", "Tell me a joke", "Write an essay about dogs"

Constraints: Extract explicit requirements from the prompt:
- Input types: "photo support", "location aware", "voice messages"
- Personality: "friendly", "professional", "casual", "strict"
- Features: "calorie tracking", "daily summaries", "reminders"
- Integrations: "with vision AI", "connects to a database", "sends images back"

Be lenient — if the prompt mentions ANY agent/bot/assistant concept, classify as "build_new" even if brief.
Only use "ambiguous" for truly meaningless prompts (1-2 generic words).
Only use "out_of_scope" for clearly non-agent requests.`;

export async function classifyIntent(prompt: string): Promise<ClassifiedIntent> {
  const modelId = process.env.AI_MODEL_FAST || "gemini-flash-lite-latest";
  const client = getUnifiedClient();

  try {
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 300,
      temperature: 0,
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const usage = response.usage as unknown as Record<string, number>;
    const cost = calculateCost(modelId, { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens });
    recordSpend(cost);

    const text = response.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();

    const parsed = JSON.parse(text) as ClassifiedIntent;
    return parsed;
  } catch (e) {
    console.warn("Intent classification failed, defaulting to build_new:", e);
    return { classification: "build_new", confidence: 0.5, constraints: [] };
  }
}
