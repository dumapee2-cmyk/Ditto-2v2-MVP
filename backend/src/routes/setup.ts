/**
 * Setup page — guides user to install and run the Bit7 Shortcut.
 * Tries to run first (if installed), falls back to install flow.
 *
 * GET /setup?phone=+19498221179
 */
import { Router } from "express";

const router = Router();

const SHORTCUT_ICLOUD_URL = "https://www.icloud.com/shortcuts/8fa2c96c5260445980fac1d725f45fe1";
const SHORTCUT_NAME = "BitSeven";

router.get("/", (req, res) => {
  const runUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BitSeven</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, system-ui, sans-serif;
      background: #f2f2f7;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px 24px;
      max-width: 340px;
      width: 100%;
      text-align: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.08);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    p { color: #666; font-size: 14px; margin-bottom: 24px; line-height: 1.4; }
    .btn {
      display: block;
      width: 100%;
      padding: 14px;
      background: #007aff;
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 17px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      margin-bottom: 12px;
    }
    .hide { display: none; }
  </style>
</head>
<body>
  <div id="step1" class="card">
    <div class="icon">📲</div>
    <h1>Connect to Bit7</h1>
    <p>Tap below to add the shortcut, then tap "Add Shortcut" and hit Run.</p>
    <a class="btn" href="${SHORTCUT_ICLOUD_URL}">Add Shortcut</a>
    <a class="btn" style="background:#34c759" href="${runUrl}">I've added it — Run</a>
  </div>

  <script>
    // If shortcut is already installed, skip straight to run
    var didLeave = false;
    document.addEventListener('visibilitychange', function() { if (document.hidden) didLeave = true; });
    window.location.href = '${runUrl}';
    setTimeout(function() {
      if (!didLeave) document.getElementById('step1').classList.remove('hide');
    }, 1500);
  </script>
</body>
</html>`);
});

export default router;
