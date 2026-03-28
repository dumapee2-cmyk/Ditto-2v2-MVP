/**
 * Document parsing — extract text from PDFs, Word docs, and other formats.
 * Used to provide context from user-uploaded documents during generation.
 */
import { readFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";

export interface ParsedDocument {
  text: string;
  pageCount?: number;
  format: "pdf" | "docx" | "txt" | "unknown";
}

/**
 * Parse a document file and extract its text content.
 * Supports PDF, DOCX, and plain text files.
 * Limits output to 50K chars to avoid token bloat.
 */
export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "pdf") {
    return parsePdfBuffer(readFileSync(filePath));
  } else if (ext === "docx") {
    return parseDocxBuffer(readFileSync(filePath));
  } else if (["txt", "md", "csv", "json", "html"].includes(ext)) {
    return parsePlainText(filePath);
  }

  return { text: "", format: "unknown" };
}

async function parsePdfBuffer(buffer: Buffer): Promise<ParsedDocument> {
  try {
    // PDFParse v4 has private type annotations on load/getText/getPageText
    // but they work fine at runtime — cast to any for access
    const parser: any = new PDFParse({ data: new Uint8Array(buffer) });
    await parser.load();

    let pageCount: number | undefined;
    try {
      const info = await parser.getInfo();
      pageCount = info?.numPages ?? undefined;
    } catch {
      // info extraction is optional
    }

    // Extract text from all pages (up to 50)
    const maxPages = Math.min(pageCount ?? 50, 50);
    const pages: string[] = [];
    for (let i = 1; i <= maxPages; i++) {
      try {
        const pageText = await parser.getPageText(i);
        if (pageText) pages.push(pageText);
      } catch {
        break;
      }
    }

    const text = pages.join("\n\n").slice(0, 50000);
    try { parser.destroy(); } catch { /* ignore */ }
    return { text, pageCount, format: "pdf" };
  } catch (err) {
    console.error(`[docParser] PDF parse failed:`, err instanceof Error ? err.message : err);
    return { text: "", format: "pdf" };
  }
}

async function parseDocxBuffer(buffer: Buffer): Promise<ParsedDocument> {
  try {
    // Dynamic import mammoth — it's CJS-only
    const mammoth = await import("mammoth");
    const fn = mammoth.extractRawText ?? (mammoth as any).default?.extractRawText;
    const result = await fn({ buffer });
    return {
      text: result.value.slice(0, 50000),
      format: "docx",
    };
  } catch (err) {
    console.error(`[docParser] DOCX parse failed:`, err instanceof Error ? err.message : err);
    return { text: "", format: "docx" };
  }
}

function parsePlainText(filePath: string): ParsedDocument {
  try {
    const text = readFileSync(filePath, "utf-8").slice(0, 50000);
    return { text, format: "txt" };
  } catch (err) {
    console.error(`[docParser] Text parse failed:`, err instanceof Error ? err.message : err);
    return { text: "", format: "txt" };
  }
}

/**
 * Parse a document from a Buffer (for uploaded files without a file path).
 */
export async function parseDocumentBuffer(
  buffer: Buffer,
  mimeType: string,
): Promise<ParsedDocument> {
  if (mimeType === "application/pdf") {
    return parsePdfBuffer(buffer);
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return parseDocxBuffer(buffer);
  }

  // Treat as plain text
  return { text: buffer.toString("utf-8").slice(0, 50000), format: "txt" };
}
