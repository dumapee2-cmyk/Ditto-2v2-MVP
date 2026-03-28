/**
 * Blind Date Engine — matchmaking via iMessage.
 *
 * Flow:
 * 1. Users sign up on the website (name, phone, school ID photo)
 * 2. Scheduler calls runMatchingCycle() every tick to pair waitlisted users
 * 3. Both matched users get a hype text: "your blind date match is ready..."
 * 4. When both reply "yes", we reveal names + numbers and send an icebreaker
 */
import { prisma } from "../db.js";
import { sendIMessage } from "./imessageClient.js";
import { getRawLLMClient } from "../unifiedClient.js";

// ---------------------------------------------------------------------------
// Matching Cycle — called from scheduler
// ---------------------------------------------------------------------------

export async function runMatchingCycle(): Promise<void> {
  // Find all waiting signups, oldest first
  const waiting = await prisma.blindDateSignup.findMany({
    where: { status: "waiting" },
    orderBy: { created_at: "asc" },
  });

  if (waiting.length < 2) return;

  // Shuffle for randomness, then pair sequentially
  const shuffled = waiting.sort(() => Math.random() - 0.5);
  const pairs = Math.floor(shuffled.length / 2);

  for (let i = 0; i < pairs; i++) {
    const a = shuffled[i * 2];
    const b = shuffled[i * 2 + 1];

    await prisma.$transaction(async (tx) => {
      // Create the match
      const match = await tx.blindDateMatch.create({
        data: {
          person_a_phone: a.phone,
          person_b_phone: b.phone,
          person_a_name: a.name,
          person_b_name: b.name,
        },
      });

      // Update both signups
      await tx.blindDateSignup.update({
        where: { id: a.id },
        data: { status: "matched", match_id: match.id },
      });
      await tx.blindDateSignup.update({
        where: { id: b.id },
        data: { status: "matched", match_id: match.id },
      });
    });

    // Send hype messages (outside transaction so DB is committed)
    const hypeA = `hey ${a.name.split(" ")[0].toLowerCase()}... your blind date match is ready 👀\n\nare you ready to find out who you got?\n\nreply "yes" when you're ready`;
    const hypeB = `hey ${b.name.split(" ")[0].toLowerCase()}... your blind date match is ready 👀\n\nare you ready to find out who you got?\n\nreply "yes" when you're ready`;

    await sendIMessage(a.phone, hypeA).catch((e) =>
      console.error(`[BlindDate] Failed to message ${a.phone}:`, e),
    );
    await sendIMessage(b.phone, hypeB).catch((e) =>
      console.error(`[BlindDate] Failed to message ${b.phone}:`, e),
    );

    console.log(`[BlindDate] Matched ${a.name} <-> ${b.name}`);
  }
}

// ---------------------------------------------------------------------------
// Reply Handler — intercepts messages from users in active matches
// ---------------------------------------------------------------------------

const YES_PATTERNS = /^(yes|yeah|yea|yep|yup|ya|ye|ready|let'?s go|lets go|ok|okay|sure|do it|go|send it|reveal|im ready|i'm ready)$/i;

/**
 * Handle an incoming message from a user who might be in a blind date match.
 * Returns true if handled (caller should skip normal agent flow).
 */
export async function handleBlindDateReply(
  userPhone: string,
  text: string,
): Promise<boolean> {
  // Find active match for this user
  const match = await prisma.blindDateMatch.findFirst({
    where: {
      status: "pending",
      OR: [{ person_a_phone: userPhone }, { person_b_phone: userPhone }],
    },
  });

  if (!match) return false;

  const isA = match.person_a_phone === userPhone;
  const trimmed = text.trim();

  // Check if they're saying yes
  if (YES_PATTERNS.test(trimmed)) {
    // Update their ready status
    await prisma.blindDateMatch.update({
      where: { id: match.id },
      data: isA ? { person_a_ready: true } : { person_b_ready: true },
    });

    // Check if both are now ready
    const otherReady = isA ? match.person_b_ready : match.person_a_ready;

    if (otherReady) {
      // Both ready — reveal!
      await revealMatch(match.id);
    } else {
      // Only this person is ready
      await sendIMessage(userPhone, "you're locked in 🔒 waiting on your match to say yes...");
    }

    return true;
  }

  // Check for cancel/no
  if (/^(no|nah|cancel|nevermind|nvm|pass|skip)$/i.test(trimmed)) {
    await cancelMatch(match.id);
    await sendIMessage(userPhone, "no worries, we'll put you back in the pool for next time");
    return true;
  }

  // They're in a match but said something else — nudge them
  await sendIMessage(userPhone, "your match is waiting... reply \"yes\" to reveal or \"no\" to skip");
  return true;
}

// ---------------------------------------------------------------------------
// Reveal — sends both parties each other's info + icebreaker
// ---------------------------------------------------------------------------

async function revealMatch(matchId: string): Promise<void> {
  const match = await prisma.blindDateMatch.update({
    where: { id: matchId },
    data: { status: "revealed", revealed_at: new Date() },
  });

  const firstNameA = match.person_a_name.split(" ")[0];
  const firstNameB = match.person_b_name.split(" ")[0];

  // Reveal to person A
  await sendIMessage(
    match.person_a_phone,
    `your blind date is... ${firstNameB}! 🎉\n\ntheir number: ${match.person_b_phone}\n\nsay hi 👋`,
  );

  // Reveal to person B
  await sendIMessage(
    match.person_b_phone,
    `your blind date is... ${firstNameA}! 🎉\n\ntheir number: ${match.person_a_phone}\n\nsay hi 👋`,
  );

  console.log(`[BlindDate] Revealed: ${firstNameA} <-> ${firstNameB}`);

  // Send icebreaker after a short delay
  setTimeout(() => sendIcebreaker(match.person_a_phone, match.person_b_phone), 30_000);
}

// ---------------------------------------------------------------------------
// Icebreaker — AI-generated conversation starter
// ---------------------------------------------------------------------------

async function sendIcebreaker(phoneA: string, phoneB: string): Promise<void> {
  try {
    const client = getRawLLMClient();
    const response = await client.chat.completions.create({
      model: "gemini-flash-lite-latest",
      max_tokens: 100,
      temperature: 1.0,
      messages: [
        {
          role: "system",
          content:
            "You are a fun matchmaker AI. Generate ONE creative icebreaker question for two college students who just got matched on a blind date app. Keep it playful, casual, lowercase texting style. One sentence only. No quotes around it.",
        },
        { role: "user", content: "give me an icebreaker" },
      ],
    });

    const icebreaker = response.choices[0]?.message?.content?.trim();
    if (!icebreaker) return;

    const msg = `here's an icebreaker for you two:\n\n${icebreaker}`;
    await sendIMessage(phoneA, msg);
    await sendIMessage(phoneB, msg);

    console.log(`[BlindDate] Icebreaker sent to both parties`);
  } catch (e) {
    console.warn("[BlindDate] Failed to generate icebreaker:", e);
  }
}

// ---------------------------------------------------------------------------
// Cancel — puts both users back in the pool
// ---------------------------------------------------------------------------

async function cancelMatch(matchId: string): Promise<void> {
  const match = await prisma.blindDateMatch.update({
    where: { id: matchId },
    data: { status: "expired" },
  });

  // Put both signups back to waiting
  await prisma.blindDateSignup.updateMany({
    where: { match_id: matchId },
    data: { status: "waiting", match_id: null },
  });

  // Notify the other person
  const otherPhone =
    match.person_a_ready ? match.person_b_phone : match.person_a_phone;
  await sendIMessage(otherPhone, "your match passed this time — we'll find you someone new soon 💫").catch(() => {});

  console.log(`[BlindDate] Match ${matchId} cancelled`);
}

// ---------------------------------------------------------------------------
// Expiration — called from scheduler to expire stale matches (24h)
// ---------------------------------------------------------------------------

export async function expireStaleMatches(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stale = await prisma.blindDateMatch.findMany({
    where: {
      status: "pending",
      created_at: { lt: cutoff },
    },
  });

  for (const match of stale) {
    await cancelMatch(match.id);
    console.log(`[BlindDate] Expired stale match ${match.id}`);
  }
}
