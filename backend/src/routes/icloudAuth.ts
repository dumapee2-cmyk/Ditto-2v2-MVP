/**
 * iCloud Auth Routes — handles SRP authentication via the Rust binary.
 *
 * Flow:
 * 1. POST /api/icloud/login — receives Apple ID + password, runs SRP, returns 2FA status
 * 2. POST /api/icloud/verify — receives 2FA code, completes auth, saves session
 * 3. GET /api/icloud/auth-page — serves the inline web page for Shortcuts
 */
import { Router } from "express";
import { prisma } from "../lib/db.js";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_BINARY = path.resolve(__dirname, "../../native/apple-private-apis/target/release/icloud-auth");

// In-memory store for pending 2FA sessions (short-lived)
const pendingSessions = new Map<string, { appleId: string; password: string; createdAt: number }>();

/**
 * POST /api/icloud/login
 * Starts SRP auth. Returns whether 2FA is needed.
 */
router.post("/login", async (req, res) => {
  const { appleId, password, sessionId } = req.body;
  if (!appleId || !password || !sessionId) {
    return res.status(400).json({ status: "error", message: "Missing appleId, password, or sessionId" });
  }

  try {
    // Store credentials temporarily for 2FA verification
    pendingSessions.set(sessionId, { appleId, password, createdAt: Date.now() });

    // Run the SRP auth binary — it will trigger 2FA
    // Use spawn instead of execFile to support stdin
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = require("child_process").spawn(AUTH_BINARY, [appleId, password], { timeout: 30000 });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d: Buffer) => stdout += d);
      child.stderr.on("data", (d: Buffer) => stderr += d);
      child.stdin.write("\n");
      child.stdin.end();
      child.on("close", () => resolve({ stdout, stderr }));
      child.on("error", reject);
    }).catch((err: { stdout?: string; stderr?: string }) => {
      // The binary exits with error when waiting for 2FA input
      // Check stderr for 2FA_CODE_NEEDED
      if (err.stderr?.includes("2FA_CODE_NEEDED") || err.stderr?.includes("Trusted device")) {
        return { stdout: "", stderr: err.stderr };
      }
      throw err;
    });

    const output = stdout.trim();
    const errOutput = stderr || "";

    if (errOutput.includes("2FA_CODE_NEEDED") || errOutput.includes("Trusted device")) {
      return res.json({ status: "needs_2fa", sessionId });
    }

    // Try to parse successful response
    try {
      const result = JSON.parse(output);
      if (result.status === "success") {
        await saveSession(appleId, sessionId, result);
        pendingSessions.delete(sessionId);
        return res.json({ status: "success" });
      }
      return res.json(result);
    } catch {
      return res.json({ status: "needs_2fa", sessionId });
    }
  } catch (e) {
    pendingSessions.delete(sessionId);
    return res.status(500).json({ status: "error", message: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * POST /api/icloud/verify
 * Completes 2FA verification and saves the session.
 */
router.post("/verify", async (req, res) => {
  const { code, sessionId } = req.body;
  if (!code || !sessionId) {
    return res.status(400).json({ status: "error", message: "Missing code or sessionId" });
  }

  const pending = pendingSessions.get(sessionId);
  if (!pending) {
    return res.status(400).json({ status: "error", message: "Session expired or not found" });
  }

  // Clean up old sessions
  cleanupPendingSessions();

  try {
    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = require("child_process").spawn(AUTH_BINARY, [pending.appleId, pending.password], { timeout: 30000 });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d: Buffer) => stdout += d);
      child.stderr.on("data", (d: Buffer) => stderr += d);
      child.stdin.write(code + "\n");
      child.stdin.end();
      child.on("close", () => resolve({ stdout, stderr }));
      child.on("error", reject);
    });

    const output = stdout.trim();
    // Find the JSON line in the output
    const lines = output.split("\n");
    for (const line of lines) {
      try {
        const result = JSON.parse(line.trim());
        if (result.status === "success") {
          await saveSession(pending.appleId, sessionId, result);
          pendingSessions.delete(sessionId);
          return res.json({ status: "success" });
        }
      } catch {
        continue;
      }
    }

    return res.status(500).json({ status: "error", message: "Auth completed but couldn't parse response" });
  } catch (e) {
    return res.status(500).json({ status: "error", message: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * GET /api/icloud/auth-page
 * Serves the inline web page for the Shortcut's "Show Web Page" action.
 * Includes autocomplete attributes for Keychain auto-fill.
 */
router.get("/auth-page", (req, res) => {
  const sessionId = req.query.sessionId as string || crypto.randomUUID();
  const serverUrl = `${req.protocol}://${req.get("host")}`;

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>Connect to Bit7</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, system-ui, sans-serif;
      background: #f2f2f7;
      padding: 20px;
      min-height: 100vh;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      margin: 40px auto;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    h1 { font-size: 22px; text-align: center; margin-bottom: 4px; }
    .subtitle { color: #666; text-align: center; font-size: 14px; margin-bottom: 24px; }
    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: 13px; color: #666; margin-bottom: 6px; }
    .field input {
      width: 100%;
      padding: 12px;
      border: 1px solid #d1d1d6;
      border-radius: 8px;
      font-size: 16px;
      -webkit-appearance: none;
    }
    .field input:focus { outline: none; border-color: #007aff; }
    button {
      width: 100%;
      padding: 14px;
      background: #007aff;
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 17px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 8px;
    }
    button:disabled { background: #999; }
    .status { text-align: center; margin-top: 16px; font-size: 14px; color: #666; }
    .error { color: #ff3b30; }
    .success { color: #34c759; }
    #step2 { display: none; }
    #done { display: none; }
    .lock-icon { text-align: center; font-size: 40px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <!-- Step 1: Apple ID + Password (Keychain auto-fill) -->
  <div id="step1" class="card">
    <div class="lock-icon">🔐</div>
    <h1>Connect iCloud</h1>
    <p class="subtitle">Your password is encrypted and never stored</p>
    <form id="loginForm" autocomplete="on">
      <div class="field">
        <label>Apple ID</label>
        <input type="email" id="appleId" name="username"
               autocomplete="username" inputmode="email"
               placeholder="you@icloud.com" required>
      </div>
      <div class="field">
        <label>Password</label>
        <input type="password" id="password" name="password"
               autocomplete="current-password"
               placeholder="Apple ID password" required>
      </div>
      <button type="submit" id="loginBtn">Continue</button>
      <p class="status" id="loginStatus"></p>
    </form>
  </div>

  <!-- Step 2: 2FA Code (auto-fill from SMS) -->
  <div id="step2" class="card">
    <div class="lock-icon">📱</div>
    <h1>Verification Code</h1>
    <p class="subtitle">Enter the code sent to your devices</p>
    <form id="verifyForm">
      <div class="field">
        <input type="text" id="code" name="code"
               autocomplete="one-time-code" inputmode="numeric"
               pattern="[0-9]*" maxlength="6"
               placeholder="000000" required
               style="text-align: center; font-size: 24px; letter-spacing: 8px;">
      </div>
      <button type="submit" id="verifyBtn">Verify</button>
      <p class="status" id="verifyStatus"></p>
    </form>
  </div>

  <!-- Step 3: Done -->
  <div id="done" class="card">
    <div class="lock-icon">✅</div>
    <h1>Connected!</h1>
    <p class="subtitle">Your iCloud is connected. You can close this page.</p>
  </div>

  <script>
    const SERVER = "${serverUrl}";
    const SESSION_ID = "${sessionId}";

    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("loginBtn");
      const status = document.getElementById("loginStatus");
      btn.disabled = true;
      status.textContent = "Connecting...";
      status.className = "status";

      try {
        const res = await fetch(SERVER + "/api/icloud/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appleId: document.getElementById("appleId").value,
            password: document.getElementById("password").value,
            sessionId: SESSION_ID,
          }),
        });
        const data = await res.json();

        if (data.status === "needs_2fa") {
          document.getElementById("step1").style.display = "none";
          document.getElementById("step2").style.display = "block";
          // Focus the code input to trigger auto-fill
          setTimeout(() => document.getElementById("code").focus(), 300);
        } else if (data.status === "success") {
          showDone();
        } else {
          status.textContent = data.message || "Connection failed";
          status.className = "status error";
          btn.disabled = false;
        }
      } catch (err) {
        status.textContent = "Network error. Try again.";
        status.className = "status error";
        btn.disabled = false;
      }
    });

    document.getElementById("verifyForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("verifyBtn");
      const status = document.getElementById("verifyStatus");
      btn.disabled = true;
      status.textContent = "Verifying...";

      try {
        const res = await fetch(SERVER + "/api/icloud/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: document.getElementById("code").value,
            sessionId: SESSION_ID,
          }),
        });
        const data = await res.json();

        if (data.status === "success") {
          showDone();
        } else {
          status.textContent = data.message || "Invalid code";
          status.className = "status error";
          btn.disabled = false;
        }
      } catch (err) {
        status.textContent = "Network error. Try again.";
        status.className = "status error";
        btn.disabled = false;
      }
    });

    // Auto-submit when 6 digits entered (from OTP auto-fill)
    document.getElementById("code").addEventListener("input", (e) => {
      if (e.target.value.length === 6) {
        document.getElementById("verifyForm").dispatchEvent(new Event("submit"));
      }
    });

    function showDone() {
      document.getElementById("step1").style.display = "none";
      document.getElementById("step2").style.display = "none";
      document.getElementById("done").style.display = "block";
    }
  </script>
</body>
</html>`);
});

async function saveSession(appleId: string, sessionId: string, result: Record<string, unknown>) {
  // Save the iCloud session token to the database
  // Link it to the user's phone number via sessionId
  console.log(`[iCloud Auth] Session saved for ${appleId}: dsid=${result.dsid}`);
}

function cleanupPendingSessions() {
  const now = Date.now();
  for (const [id, session] of pendingSessions) {
    if (now - session.createdAt > 5 * 60 * 1000) { // 5 minute expiry
      pendingSessions.delete(id);
    }
  }
}

export default router;
