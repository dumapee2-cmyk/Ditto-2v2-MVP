/**
 * Vision — image analysis using Gemini vision models.
 * Falls back to OpenAI GPT-4o if OPENAI_API_KEY is set.
 */
import OpenAI from "openai";
import { getRawLLMClient } from "./unifiedClient.js";

export async function analyzeImage(
  base64DataUrl: string,
  prompt: string,
  _modelOverride?: string,
): Promise<string> {
  if (process.env.OPENAI_API_KEY) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 200,
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: base64DataUrl, detail: "auto" } },
      ]}],
    });
    return response.choices[0]?.message?.content ?? "Unable to analyze image.";
  }

  const client = getRawLLMClient();
  const response = await client.chat.completions.create({
    model: "gemini-flash-lite-latest",
    max_tokens: 200,
    messages: [{ role: "user", content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: base64DataUrl, detail: "auto" } },
    ]}],
  });
  return response.choices[0]?.message?.content ?? "Unable to analyze image.";
}

export async function extractFromPhoto(
  base64DataUrl: string,
  extractionPrompt: string,
): Promise<string> {
  return analyzeImage(base64DataUrl, extractionPrompt);
}
