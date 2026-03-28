import rateLimit from "express-rate-limit";

export const generateRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Rate limit exceeded. Max 5 app generations per hour." },
});

export const runRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Rate limit exceeded. Max 20 executions per hour." },
});

const BLOCKED_PATTERNS = [
  /\bgenerate\s+(malware|ransomware|spyware|virus|worm|trojan)\b/i,
  /\bwrite\s+(exploit|shellcode|payload|backdoor)\b/i,
  /\bcreate\s+(exploit|rootkit|keylogger)\b/i,
  /\b(child\s*(sex|porn|abuse)|csam)\b/i,
  /\b(credit\s*card\s*(number|cvv|pin)|steal\s*(credit|debit|card))\b/i,
  /\b(doxx|doxing)\b/i,
];

export function checkContentSafety(text: string): { safe: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: "Prompt contains prohibited content." };
    }
  }
  return { safe: true };
}
