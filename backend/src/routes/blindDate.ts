/**
 * Blind Date API — signup endpoint for the waitlist.
 *
 * POST /api/blind-date/signup — multipart/form-data with name, phone, school_id (file)
 * GET  /api/blind-date/status/:phone — check signup status
 */
import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/db.js";

export const blindDateRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

/** Normalize phone to E.164 (+1XXXXXXXXXX) */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// ---------------------------------------------------------------------------
// POST /signup
// ---------------------------------------------------------------------------

blindDateRouter.post("/signup", upload.single("school_id"), async (req, res) => {
  try {
    const { name, phone, gender, looking_for, hobbies } = req.body;
    const file = req.file;

    if (!name || !phone || !file) {
      return res.status(400).json({ ok: false, error: "name, phone, and school_id photo are required" });
    }

    const normalized = normalizePhone(phone);
    if (!normalized) {
      return res.status(400).json({ ok: false, error: "invalid phone number" });
    }

    // Check for existing signup
    const existing = await prisma.blindDateSignup.findUnique({
      where: { phone: normalized },
    });
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: "you're already signed up!",
        status: existing.status,
      });
    }

    // Store school ID as base64 data URL
    const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

    let parsedHobbies: string[] = [];
    try { parsedHobbies = hobbies ? JSON.parse(hobbies) : []; } catch { /* ignore */ }

    const signup = await prisma.blindDateSignup.create({
      data: {
        name: name.trim(),
        phone: normalized,
        school_id_url: base64,
        gender: gender || null,
        looking_for: looking_for || null,
        hobbies: parsedHobbies,
      },
    });

    // Count position in queue
    const position = await prisma.blindDateSignup.count({
      where: { status: "waiting", created_at: { lte: signup.created_at } },
    });

    console.log(`[BlindDate] New signup: ${name} (${normalized}), position #${position}`);

    // Push to Google Sheet (fire-and-forget)
    const sheetWebhook = process.env.GOOGLE_SHEET_WEBHOOK;
    if (sheetWebhook) {
      fetch(sheetWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: normalized,
          position,
          timestamp: new Date().toISOString(),
        }),
      }).catch((err) => console.warn("[BlindDate] Sheet webhook failed:", err));
    }

    return res.json({ ok: true, position });
  } catch (e) {
    console.error("[BlindDate] Signup error:", e);
    return res.status(500).json({ ok: false, error: "something went wrong" });
  }
});

// ---------------------------------------------------------------------------
// GET /status/:phone
// ---------------------------------------------------------------------------

blindDateRouter.get("/status/:phone", async (req, res) => {
  const normalized = normalizePhone(req.params.phone);
  if (!normalized) {
    return res.status(400).json({ ok: false, error: "invalid phone number" });
  }

  const signup = await prisma.blindDateSignup.findUnique({
    where: { phone: normalized },
  });

  if (!signup) {
    return res.status(404).json({ ok: false, error: "not found" });
  }

  return res.json({
    ok: true,
    status: signup.status,
    name: signup.name,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/signups — all signups for admin dashboard
// ---------------------------------------------------------------------------

blindDateRouter.get("/admin/signups", async (_req, res) => {
  const signups = await prisma.blindDateSignup.findMany({
    orderBy: { created_at: "desc" },
    take: 500,
  });
  return res.json({ ok: true, signups });
});

blindDateRouter.delete("/admin/signups/:id", async (req, res) => {
  try {
    await prisma.blindDateSignup.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch {
    return res.status(404).json({ ok: false, error: "not found" });
  }
});
