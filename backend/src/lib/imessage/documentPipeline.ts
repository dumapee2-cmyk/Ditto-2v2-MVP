/**
 * Document Pipeline — ingest and generate documents via iMessage.
 *
 * Incoming: User sends a PDF/DOC → extract text → summarize → offer actions
 * Outgoing: LLM generates content → render to PDF → send as attachment
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { getRawLLMClient } from "../unifiedClient.js";
import { getIMessageSDK } from "./imessageClient.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpFile(prefix: string, ext: string): string {
  return path.join(os.tmpdir(), `bit7-doc-${prefix}-${Date.now()}${ext}`);
}

function cleanUp(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch {}
}

// ---------------------------------------------------------------------------
// Ingestion — extract text from documents
// ---------------------------------------------------------------------------

/**
 * Extract text from a PDF file using macOS built-in tools.
 * Uses `mdimport` metadata or falls back to `textutil` for supported formats.
 * For PDFs, uses Python's built-in capabilities (available on macOS).
 */
export async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  try {
    switch (ext) {
      case ".pdf": {
        // Use macOS's built-in Python + PyObjC to extract PDF text
        // This avoids needing any npm dependencies
        const script = `
import sys
try:
    import Quartz
    pdf_url = Quartz.CFURLCreateFromFileSystemRepresentation(None, sys.argv[1].encode(), len(sys.argv[1].encode()), False)
    pdf_doc = Quartz.CGPDFDocumentCreateWithURL(pdf_url)
    if not pdf_doc:
        print("[Could not read PDF]")
        sys.exit(0)
    page_count = Quartz.CGPDFDocumentGetNumberOfPages(pdf_doc)
    # Fall through to textutil approach
    raise ImportError("Use textutil")
except ImportError:
    pass

import subprocess
result = subprocess.run(['textutil', '-convert', 'txt', '-stdout', sys.argv[1]], capture_output=True, text=True, timeout=30)
if result.returncode == 0 and result.stdout.strip():
    print(result.stdout[:10000])
else:
    # Last resort: use strings command
    result = subprocess.run(['strings', sys.argv[1]], capture_output=True, text=True, timeout=30)
    print(result.stdout[:10000])
`;
        const pyPath = tmpFile("extract", ".py");
        fs.writeFileSync(pyPath, script);
        try {
          const result = execSync(`python3 "${pyPath}" "${filePath}"`, {
            timeout: 30_000,
            encoding: "utf-8",
            maxBuffer: 1024 * 1024,
          });
          return result.trim() || "[Could not extract text from PDF]";
        } finally {
          cleanUp(pyPath);
        }
      }

      case ".doc":
      case ".docx":
      case ".rtf":
      case ".rtfd": {
        // macOS textutil handles these natively
        const result = execSync(`textutil -convert txt -stdout "${filePath}"`, {
          timeout: 30_000,
          encoding: "utf-8",
          maxBuffer: 1024 * 1024,
        });
        return result.trim() || "[Could not extract text]";
      }

      case ".txt":
      case ".md":
      case ".csv":
      case ".json": {
        return fs.readFileSync(filePath, "utf-8").slice(0, 10_000);
      }

      default:
        return `[Unsupported file type: ${ext}]`;
    }
  } catch (e) {
    console.warn(`[DocPipeline] Text extraction failed for ${ext}:`, e);
    return `[Failed to extract text from ${ext} file]`;
  }
}

/**
 * Summarize extracted document text using the LLM.
 */
export async function summarizeDocument(text: string, userHint?: string): Promise<string> {
  const llm = getRawLLMClient();
  const completion = await llm.chat.completions.create({
    model: "gemini-flash-lite-latest",
    max_tokens: 400,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "Summarize this document concisely. Start with a one-line overview, then list the key points. " +
          "If it's a receipt or invoice, extract the total amount. " +
          "If it's a contract, highlight key terms and dates. " +
          "If it's academic, summarize the main arguments/findings. " +
          "Max 5 bullet points." +
          (userHint ? `\nUser's question: ${userHint}` : ""),
      },
      { role: "user", content: text.slice(0, 5000) },
    ],
  });

  return completion.choices[0]?.message?.content ?? "Could not generate summary.";
}

// ---------------------------------------------------------------------------
// Generation — create documents and send as attachments
// ---------------------------------------------------------------------------

export type DocumentType =
  | "cover_letter"
  | "meeting_notes"
  | "study_guide"
  | "expense_report"
  | "custom";

interface GenerateDocumentParams {
  type: DocumentType;
  content: string;
  title?: string;
  userPhone: string;
}

const DOC_PROMPTS: Record<DocumentType, string> = {
  cover_letter:
    "Generate a professional cover letter based on the provided details. " +
    "Use proper business letter formatting with paragraphs. Be specific and avoid generic filler.",

  meeting_notes:
    "Format these as professional meeting notes with: " +
    "Date, Attendees, Agenda Items, Discussion Summary, Action Items, Next Steps.",

  study_guide:
    "Create a study guide with: Key Concepts (definitions), Important Details (bullet points), " +
    "Practice Questions (3-5), and Quick Review Summary.",

  expense_report:
    "Format this as an expense report with: Date Range, Line Items (date, description, category, amount), " +
    "Category Subtotals, and Grand Total.",

  custom:
    "Generate a well-formatted document based on the user's request. " +
    "Use clear headings, bullet points, and logical organization.",
};

/**
 * Generate a document and send it as a PDF attachment via iMessage.
 */
export async function generateAndSendDocument(params: GenerateDocumentParams): Promise<string> {
  const { type, content, title, userPhone } = params;

  // Step 1: Generate document content via LLM
  const llm = getRawLLMClient();
  const completion = await llm.chat.completions.create({
    model: "gemini-flash-lite-latest",
    max_tokens: 1500,
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content:
          DOC_PROMPTS[type] +
          "\n\nOutput the document content in clean, well-formatted text. " +
          "Use clear section headers with ALL CAPS. " +
          "Do not include any markdown formatting symbols.",
      },
      { role: "user", content },
    ],
  });

  const docContent = completion.choices[0]?.message?.content;
  if (!docContent) return "Failed to generate document content.";

  // Step 2: Convert to PDF using macOS textutil + cupsfilter
  const docTitle = title ?? `Bit7 ${type.replace(/_/g, " ")}`;
  const txtPath = tmpFile("gen", ".txt");
  const rtfPath = tmpFile("gen", ".rtf");
  const pdfPath = tmpFile("gen", ".pdf");

  try {
    // Write content to text file
    const formattedContent = `${docTitle.toUpperCase()}\n${"=".repeat(docTitle.length)}\n\n${docContent}`;
    fs.writeFileSync(txtPath, formattedContent, "utf-8");

    // Convert txt → rtf → pdf using macOS built-in tools
    execSync(`textutil -convert rtf -output "${rtfPath}" "${txtPath}"`, {
      timeout: 15_000,
      stdio: "ignore",
    });

    // RTF → PDF using cupsfilter (available on all macOS)
    execSync(
      `/usr/sbin/cupsfilter "${rtfPath}" > "${pdfPath}" 2>/dev/null`,
      { timeout: 30_000, shell: "/bin/bash" },
    );

    // Verify PDF was created
    if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
      // Fallback: just send as text file
      const sdk = getIMessageSDK();
      await sdk.sendFile(userPhone, txtPath, docTitle);
      return `Generated "${docTitle}" (sent as text — PDF conversion unavailable).`;
    }

    // Step 3: Send via iMessage
    const sdk = getIMessageSDK();
    await sdk.sendFile(userPhone, pdfPath, docTitle);
    return `"${docTitle}" generated and sent as PDF.`;
  } catch (e) {
    // Fallback: send as text file
    try {
      if (fs.existsSync(txtPath)) {
        const sdk = getIMessageSDK();
        await sdk.sendFile(userPhone, txtPath, docTitle);
        return `Generated "${docTitle}" (sent as text file).`;
      }
    } catch {}
    return `Failed to generate document: ${e instanceof Error ? e.message : e}`;
  } finally {
    cleanUp(txtPath);
    cleanUp(rtfPath);
    cleanUp(pdfPath);
  }
}

/**
 * Process an incoming document attachment — extract text and summarize.
 * Returns a context string for the LLM.
 */
export async function processDocumentAttachment(
  filePath: string,
  userHint?: string,
): Promise<string> {
  const text = await extractTextFromFile(filePath);

  if (text.startsWith("[")) {
    // Extraction failed
    return text;
  }

  const summary = await summarizeDocument(text, userHint);

  return `[Document received and analyzed]\n${summary}\n\n[Full text available — ${text.length} characters extracted]`;
}
