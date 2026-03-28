/**
 * Browser Session — Playwright-based headless browser for the agent.
 *
 * Provides text-only page interaction: the LLM reads extracted text
 * and numbered interactive elements to navigate any website.
 */
import { chromium, type BrowserContext, type Page, type Cookie } from "playwright";
import { saveCookiesForDomain, loadCookiesForDomain } from "./cookieStore.js";

// ---------------------------------------------------------------------------
// Session manager
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, BrowserSession>();

export async function createSession(userPhone: string): Promise<string> {
  // Only one session per user at a time
  const existing = [...activeSessions.entries()].find(
    ([, s]) => s.userPhone === userPhone,
  );
  if (existing) {
    await destroySession(existing[0]);
  }

  const session = new BrowserSession(userPhone);
  await session.init();
  activeSessions.set(session.id, session);
  return session.id;
}

export function getSession(sessionId: string): BrowserSession | null {
  return activeSessions.get(sessionId) ?? null;
}

export function getSessionForUser(userPhone: string): BrowserSession | null {
  for (const s of activeSessions.values()) {
    if (s.userPhone === userPhone) return s;
  }
  return null;
}

export async function destroySession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (session) {
    await session.close();
    activeSessions.delete(sessionId);
  }
}

export async function destroyUserSessions(userPhone: string): Promise<void> {
  for (const [id, s] of activeSessions.entries()) {
    if (s.userPhone === userPhone) {
      await s.close();
      activeSessions.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Interactive element tracking
// ---------------------------------------------------------------------------

interface InteractiveElement {
  index: number;
  tag: string;
  type?: string;
  text: string;
  selector: string;
}

// ---------------------------------------------------------------------------
// BrowserSession class
// ---------------------------------------------------------------------------

export class BrowserSession {
  id: string;
  userPhone: string;
  credentialsProvided = false;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private elements: InteractiveElement[] = [];

  constructor(userPhone: string) {
    this.id = `bs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.userPhone = userPhone;
  }

  async init(): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    this.context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
    });
    this.page = await this.context.newPage();
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  async goTo(url: string): Promise<string> {
    const p = this.getPage();

    // Load saved cookies for this domain before navigating
    const domain = this.extractDomain(url);
    const cookies = await loadCookiesForDomain(this.userPhone, domain);
    if (cookies?.length) {
      await this.context!.addCookies(cookies);
    }

    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await this.randomDelay(500, 1500);
    return `Navigated to: ${p.url()}\nTitle: ${await p.title()}`;
  }

  // -------------------------------------------------------------------------
  // Page reading (text-only, no vision)
  // -------------------------------------------------------------------------

  async extractText(selector?: string): Promise<string> {
    const p = this.getPage();
    const target = selector ? await p.$(selector) : p;
    if (!target) return "(Element not found)";

    const text = await (selector
      ? (target as any).innerText()
      : p.evaluate(() => document.body.innerText));

    // Truncate for LLM context window
    const cleaned = (text as string)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 3000);
    return cleaned || "(Page has no visible text)";
  }

  async getInteractiveElements(): Promise<string> {
    const p = this.getPage();

    this.elements = await p.evaluate(() => {
      const results: {
        index: number;
        tag: string;
        type?: string;
        text: string;
        selector: string;
      }[] = [];

      const seen = new Set<Element>();
      let idx = 1;

      // Collect all interactive elements
      const selectors = [
        "a[href]",
        "button",
        "input",
        "textarea",
        "select",
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="tab"]',
        "[onclick]",
      ];

      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (seen.has(el)) continue;
          // Skip hidden/tiny elements
          const rect = el.getBoundingClientRect();
          if (rect.width < 5 || rect.height < 5) continue;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;

          seen.add(el);

          const tag = el.tagName.toLowerCase();
          const type = (el as HTMLInputElement).type || undefined;
          const ariaLabel = el.getAttribute("aria-label") || "";
          const placeholder = el.getAttribute("placeholder") || "";
          const innerText = (el.textContent || "").trim().slice(0, 60);
          const text = ariaLabel || placeholder || innerText || `(${tag})`;

          // Build a unique selector for this element
          let selector = "";
          const id = el.getAttribute("id");
          const name = el.getAttribute("name");
          if (id) {
            selector = `#${id}`;
          } else if (name) {
            selector = `${tag}[name="${name}"]`;
          } else if (ariaLabel) {
            selector = `[aria-label="${ariaLabel}"]`;
          } else {
            // Use nth-of-type as fallback
            const parent = el.parentElement;
            if (parent) {
              const siblings = parent.querySelectorAll(`:scope > ${tag}`);
              const nth = Array.from(siblings).indexOf(el) + 1;
              selector = `${tag}:nth-of-type(${nth})`;
            }
          }

          results.push({ index: idx, tag, type, text, selector });
          idx++;

          if (idx > 40) break; // Cap at 40 elements
        }
        if (idx > 40) break;
      }

      return results;
    });

    if (!this.elements.length) return "(No interactive elements found on page)";

    // Detect login forms — if there's a password field and no credentials provided, signal NEEDS_SETUP
    const hasPasswordField = this.elements.some(
      (el) => el.tag === "input" && el.type === "password",
    );
    if (hasPasswordField && !this.credentialsProvided) {
      const domain = this.extractDomain(this.getPage().url());
      return `LOGIN_REQUIRED:${domain}`;
    }

    const lines = this.elements.map((el) => {
      const typeStr = el.type ? ` (${el.type})` : "";
      return `[${el.index}] ${el.tag}${typeStr}: "${el.text}"`;
    });
    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  async click(elementNumber: number): Promise<string> {
    const el = this.elements.find((e) => e.index === elementNumber);
    if (!el) return `Element [${elementNumber}] not found. Call get_elements first.`;

    const p = this.getPage();
    try {
      await p.click(el.selector, { timeout: 5000 });
      await this.randomDelay(500, 1500);
      // Wait for any navigation or network activity to settle
      await p.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      return `Clicked [${elementNumber}] "${el.text}". Page: ${p.url()}`;
    } catch (e) {
      return `Failed to click [${elementNumber}]: ${e instanceof Error ? e.message : e}`;
    }
  }

  async type(elementNumber: number, text: string): Promise<string> {
    const el = this.elements.find((e) => e.index === elementNumber);
    if (!el) return `Element [${elementNumber}] not found. Call get_elements first.`;

    const p = this.getPage();
    try {
      await p.click(el.selector, { timeout: 3000 });
      await this.randomDelay(200, 500);
      await p.fill(el.selector, text);
      await this.randomDelay(300, 800);
      return `Typed into [${elementNumber}] "${el.text}"`;
    } catch (e) {
      return `Failed to type into [${elementNumber}]: ${e instanceof Error ? e.message : e}`;
    }
  }

  async uploadFile(elementNumber: number, filePath: string): Promise<string> {
    const el = this.elements.find((e) => e.index === elementNumber);
    if (!el) return `Element [${elementNumber}] not found. Call get_elements first.`;

    const p = this.getPage();
    try {
      await p.setInputFiles(el.selector, filePath);
      await this.randomDelay(1000, 2000);
      return `Uploaded file to [${elementNumber}]`;
    } catch (e) {
      return `Failed to upload: ${e instanceof Error ? e.message : e}`;
    }
  }

  async scroll(direction: "up" | "down"): Promise<string> {
    const p = this.getPage();
    const delta = direction === "down" ? 600 : -600;
    await p.mouse.wheel(0, delta);
    await this.randomDelay(500, 1000);
    return `Scrolled ${direction}`;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.page) {
      // Save cookies for the current domain
      const url = this.page.url();
      if (url && url !== "about:blank") {
        const domain = this.extractDomain(url);
        const cookies = await this.context!.cookies();
        if (cookies.length) {
          await saveCookiesForDomain(this.userPhone, domain, cookies).catch(
            () => {},
          );
        }
      }
    }
    const browser = this.context?.browser();
    await browser?.close().catch(() => {});
    this.context = null;
    this.page = null;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  getCurrentUrl(): string {
    return this.page?.url() ?? "about:blank";
  }

  private getPage(): Page {
    if (!this.page) throw new Error("Browser session not initialized");
    return this.page;
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private async randomDelay(min: number, max: number): Promise<void> {
    const ms = min + Math.random() * (max - min);
    await new Promise((r) => setTimeout(r, ms));
  }
}

// ---------------------------------------------------------------------------
// Tool executor (called from agentTools.ts)
// ---------------------------------------------------------------------------

export async function executeBrowser(
  action: string,
  params: Record<string, unknown>,
  userPhone: string,
): Promise<string> {
  switch (action) {
    case "start": {
      const sessionId = await createSession(userPhone);
      return `Browser started (session: ${sessionId}). Use go_to to navigate.`;
    }

    case "go_to": {
      const session = getSessionForUser(userPhone);
      if (!session) return "No browser session. Call start first.";
      const url = params.url as string;
      if (!url) return "Missing url parameter.";
      return session.goTo(url);
    }

    case "extract_text": {
      const session = getSessionForUser(userPhone);
      if (!session) return "No browser session. Call start first.";
      return session.extractText(params.selector as string | undefined);
    }

    case "get_elements": {
      const session = getSessionForUser(userPhone);
      if (!session) return "No browser session. Call start first.";
      const result = await session.getInteractiveElements();
      // If login detected and no credentials, stop browser and signal NEEDS_SETUP
      if (result.startsWith("LOGIN_REQUIRED:")) {
        const domain = result.split(":")[1];
        const currentUrl = session.getCurrentUrl();
        await destroyUserSessions(userPhone);
        // Format: NEEDS_SETUP:login:<JSON metadata>\n<user-facing message>
        const meta = JSON.stringify({ domain, url: currentUrl });
        return `NEEDS_SETUP:login:${meta}\nI need to log in to ${domain} for you — just send me your email and password and I'll handle the rest. Your credentials are only used once to sign in, then I save cookies so you won't need to do this again.`;
      }
      return result;
    }

    case "click": {
      const session = getSessionForUser(userPhone);
      if (!session) return "No browser session. Call start first.";
      const element = params.element as number;
      if (!element) return "Missing element number. Call get_elements first.";
      return session.click(element);
    }

    case "type": {
      const session = getSessionForUser(userPhone);
      if (!session) return "No browser session. Call start first.";
      const element = params.element as number;
      const text = params.text as string;
      if (!element || !text) return "Missing element number or text.";
      return session.type(element, text);
    }

    case "upload_file": {
      const session = getSessionForUser(userPhone);
      if (!session) return "No browser session. Call start first.";
      const element = params.element as number;
      const filePath = params.file_path as string;
      if (!element || !filePath) return "Missing element number or file_path.";
      return session.uploadFile(element, filePath);
    }

    case "scroll": {
      const session = getSessionForUser(userPhone);
      if (!session) return "No browser session. Call start first.";
      const direction = (params.direction as string) === "up" ? "up" : "down";
      return session.scroll(direction);
    }

    case "stop": {
      await destroyUserSessions(userPhone);
      return "Browser closed.";
    }

    default:
      return `Unknown browser action: ${action}`;
  }
}
