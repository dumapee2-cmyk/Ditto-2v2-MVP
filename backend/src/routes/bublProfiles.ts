/**
 * Bubl Profiles API — user profiles, stats, and profile cards.
 *
 * POST /api/bubl/profile     — create or update profile
 * GET  /api/bubl/profile/:phone — get profile card
 * GET  /api/bubl/stats/:phone   — get user stats
 * GET  /api/bubl/profiles       — list active profiles (admin)
 */
import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/db.js";

export const bublRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// ---------------------------------------------------------------------------
// POST /profile — create or update
// ---------------------------------------------------------------------------
bublRouter.post("/profile", upload.array("photos", 6), async (req, res) => {
  try {
    const { name, phone, age, gender, bio, interests, location, school, looking_for } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ ok: false, error: "name and phone are required" });
    }

    const normalized = normalizePhone(phone);
    if (!normalized) {
      return res.status(400).json({ ok: false, error: "invalid phone number" });
    }

    // Process photos
    const photos = (req.files as Express.Multer.File[] | undefined) ?? [];
    const photoUrls = photos.map(f => `data:${f.mimetype};base64,${f.buffer.toString("base64")}`);

    // Parse interests
    let parsedInterests: string[] = [];
    if (interests) {
      try {
        parsedInterests = typeof interests === "string" ? JSON.parse(interests) : interests;
      } catch {
        parsedInterests = interests.split(",").map((s: string) => s.trim()).filter(Boolean);
      }
    }

    const profile = await prisma.bublProfile.upsert({
      where: { phone: normalized },
      create: {
        phone: normalized,
        name: name.trim(),
        age: age ? parseInt(age) : null,
        gender: gender || null,
        bio: bio || null,
        photo_urls: photoUrls,
        interests: parsedInterests,
        location: location || null,
        school: school || null,
        looking_for: looking_for || null,
      },
      update: {
        name: name.trim(),
        ...(age && { age: parseInt(age) }),
        ...(gender && { gender }),
        ...(bio && { bio }),
        ...(photoUrls.length > 0 && { photo_urls: photoUrls }),
        ...(parsedInterests.length > 0 && { interests: parsedInterests }),
        ...(location && { location }),
        ...(school && { school }),
        ...(looking_for && { looking_for }),
        updated_at: new Date(),
      },
    });

    console.log(`[Bubl] Profile saved: ${name} (${normalized})`);

    return res.json({ ok: true, profile: sanitizeProfile(profile) });
  } catch (e) {
    console.error("[Bubl] Profile error:", e);
    return res.status(500).json({ ok: false, error: "something went wrong" });
  }
});

// ---------------------------------------------------------------------------
// GET /profile/:phone — profile card
// ---------------------------------------------------------------------------
bublRouter.get("/profile/:phone", async (req, res) => {
  const normalized = normalizePhone(req.params.phone);
  if (!normalized) {
    return res.status(400).json({ ok: false, error: "invalid phone number" });
  }

  const profile = await prisma.bublProfile.findUnique({
    where: { phone: normalized },
  });

  if (!profile) {
    return res.status(404).json({ ok: false, error: "profile not found" });
  }

  return res.json({ ok: true, profile: sanitizeProfile(profile) });
});

// ---------------------------------------------------------------------------
// GET /stats/:phone — user stats
// ---------------------------------------------------------------------------
bublRouter.get("/stats/:phone", async (req, res) => {
  const normalized = normalizePhone(req.params.phone);
  if (!normalized) {
    return res.status(400).json({ ok: false, error: "invalid phone number" });
  }

  const profile = await prisma.bublProfile.findUnique({
    where: { phone: normalized },
    select: { name: true, stats: true, created_at: true },
  });

  if (!profile) {
    return res.status(404).json({ ok: false, error: "profile not found" });
  }

  const weeksActive = Math.floor((Date.now() - profile.created_at.getTime()) / (7 * 24 * 60 * 60 * 1000));

  return res.json({
    ok: true,
    name: profile.name,
    weeks_active: weeksActive,
    stats: profile.stats,
  });
});

// ---------------------------------------------------------------------------
// GET /profiles — list active profiles (for admin/matching)
// ---------------------------------------------------------------------------
bublRouter.get("/profiles", async (req, res) => {
  const location = req.query.location as string | undefined;
  const gender = req.query.gender as string | undefined;

  const profiles = await prisma.bublProfile.findMany({
    where: {
      active: true,
      ...(location && { location: { contains: location, mode: "insensitive" as const } }),
      ...(gender && { gender }),
    },
    orderBy: { created_at: "desc" },
    take: 100,
  });

  return res.json({
    ok: true,
    count: profiles.length,
    profiles: profiles.map(sanitizeProfile),
  });
});

// ---------------------------------------------------------------------------
// Profile card HTML — shareable card
// ---------------------------------------------------------------------------
bublRouter.get("/card/:phone", async (req, res) => {
  const normalized = normalizePhone(req.params.phone);
  if (!normalized) return res.status(400).send("invalid phone");

  const profile = await prisma.bublProfile.findUnique({ where: { phone: normalized } });
  if (!profile) return res.status(404).send("not found");

  const photos = profile.photo_urls as string[];
  const interests = profile.interests as string[];
  const mainPhoto = photos[0] || "";

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${profile.name} — bubl</title>
  <meta property="og:title" content="${profile.name} — bubl">
  <meta property="og:description" content="${profile.bio || "on bubl"}">
  ${mainPhoto ? `<meta property="og:image" content="${mainPhoto}">` : ""}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #000; color: #fff; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
    .card { background: #1c1c1e; border-radius: 24px; max-width: 360px; width: 100%; overflow: hidden; }
    .photo { width: 100%; aspect-ratio: 3/4; object-fit: cover; }
    .info { padding: 20px; }
    .name { font-size: 24px; font-weight: 700; }
    .age { font-size: 24px; font-weight: 300; color: #999; margin-left: 8px; }
    .location { color: #999; font-size: 14px; margin-top: 4px; }
    .bio { margin-top: 12px; font-size: 15px; line-height: 1.4; color: #ccc; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .tag { background: #2c2c2e; padding: 6px 12px; border-radius: 20px; font-size: 13px; color: #fff; }
    .footer { text-align: center; padding: 16px; border-top: 1px solid #2c2c2e; }
    .footer span { color: #ff375f; font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    ${mainPhoto ? `<img class="photo" src="${mainPhoto}" alt="${profile.name}">` : ""}
    <div class="info">
      <div><span class="name">${profile.name}</span>${profile.age ? `<span class="age">${profile.age}</span>` : ""}</div>
      ${profile.location ? `<p class="location">${profile.location}</p>` : ""}
      ${profile.school ? `<p class="location">${profile.school}</p>` : ""}
      ${profile.bio ? `<p class="bio">${profile.bio}</p>` : ""}
      ${interests.length ? `<div class="tags">${interests.map(i => `<span class="tag">${i}</span>`).join("")}</div>` : ""}
    </div>
    <div class="footer"><span>bubl.</span></div>
  </div>
</body>
</html>`);
});

/** Strip phone from public profile */
function sanitizeProfile(p: Record<string, unknown>) {
  const { phone, ...rest } = p;
  return rest;
}
