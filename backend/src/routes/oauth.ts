/**
 * OAuth Routes — handles OAuth flows for Spotify, Gmail, and other services.
 * Users connect their accounts by visiting /oauth/<service>/connect?phone=+1xxx
 * which redirects them through the OAuth flow and stores tokens in the DB.
 */
import { Router } from "express";
import { prisma } from "../lib/db.js";

export const oauthRouter = Router();

// ─── Spotify OAuth ───────────────────────────────────────────────

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI ?? "http://localhost:4000/oauth/spotify/callback";

oauthRouter.get("/spotify/connect", (req, res) => {
  const phone = req.query.phone as string;
  if (!phone) return res.status(400).json({ error: "phone query param required" });
  if (!SPOTIFY_CLIENT_ID) return res.status(500).json({ error: "SPOTIFY_CLIENT_ID not configured" });

  const scopes = "user-read-playback-state user-modify-playback-state user-read-currently-playing streaming";
  const state = Buffer.from(JSON.stringify({ phone })).toString("base64url");
  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${SPOTIFY_CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI)}&state=${state}`;

  res.redirect(authUrl);
});

oauthRouter.get("/spotify/callback", async (req, res) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  if (!code || !state) return res.status(400).json({ error: "Missing code or state" });

  let phone: string;
  try {
    phone = JSON.parse(Buffer.from(state, "base64url").toString()).phone;
  } catch {
    return res.status(400).json({ error: "Invalid state" });
  }

  try {
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(502).json({ error: "Token exchange failed", details: err });
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    await prisma.oAuthToken.upsert({
      where: { user_phone_service: { user_phone: phone, service: "spotify" } },
      update: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? null,
        expires_at: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
      },
      create: {
        user_phone: phone,
        service: "spotify",
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? null,
        expires_at: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
      },
    });

    res.send("Spotify connected! You can close this window.");
  } catch (e) {
    console.error("[OAuth] Spotify callback error:", e);
    res.status(500).json({ error: "OAuth callback failed" });
  }
});

// ─── Gmail OAuth ─────────────────────────────────────────────────

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID ?? "";
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET ?? "";
const GMAIL_REDIRECT_URI = process.env.GMAIL_REDIRECT_URI ?? "http://localhost:4000/oauth/gmail/callback";

oauthRouter.get("/gmail/connect", (req, res) => {
  const phone = req.query.phone as string;
  if (!phone) return res.status(400).json({ error: "phone query param required" });
  if (!GMAIL_CLIENT_ID) return res.status(500).json({ error: "GMAIL_CLIENT_ID not configured" });

  const scopes = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
  const state = Buffer.from(JSON.stringify({ phone })).toString("base64url");
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${GMAIL_CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(GMAIL_REDIRECT_URI)}&state=${state}&access_type=offline&prompt=consent`;

  res.redirect(authUrl);
});

oauthRouter.get("/gmail/callback", async (req, res) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  if (!code || !state) return res.status(400).json({ error: "Missing code or state" });

  let phone: string;
  try {
    phone = JSON.parse(Buffer.from(state, "base64url").toString()).phone;
  } catch {
    return res.status(400).json({ error: "Invalid state" });
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: GMAIL_REDIRECT_URI,
        client_id: GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(502).json({ error: "Token exchange failed", details: err });
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    await prisma.oAuthToken.upsert({
      where: { user_phone_service: { user_phone: phone, service: "gmail" } },
      update: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? null,
        expires_at: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
      },
      create: {
        user_phone: phone,
        service: "gmail",
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? null,
        expires_at: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
      },
    });

    res.send("Gmail connected! You can close this window.");
  } catch (e) {
    console.error("[OAuth] Gmail callback error:", e);
    res.status(500).json({ error: "OAuth callback failed" });
  }
});
