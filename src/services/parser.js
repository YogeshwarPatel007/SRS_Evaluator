import fs from "fs";
import path from "path";

// ── Section detection keywords ────────────────────────────────
const SECTION_PATTERNS = {
  functional_requirements: [
    /functional\s+req/i, /\b3\.\s*functional/i, /\bfr[-\s]?\d/i,
    /functions\s+of\s+the\s+system/i, /system\s+functions/i
  ],
  performance_requirements: [
    /performance\s+req/i, /\b4\.\s*performance/i, /non[-\s]?functional/i,
    /nfr[-\s]?\d/i, /performance\s+constraint/i
  ],
  design_constraints: [
    /design\s+constraint/i, /\b5\.\s*design/i, /constraints/i,
    /design\s+limitation/i, /implementation\s+constraint/i
  ],
  external_interfaces: [
    /external\s+interface/i, /\b6\.\s*external/i, /interface\s+req/i,
    /api\s+interface/i, /system\s+interface/i
  ],
  security_requirements: [
    /security\s+req/i, /\b7\.\s*security/i, /security\s+constraint/i,
    /access\s+control/i, /authentication\s+req/i
  ],
  use_cases: [
    /use\s+case/i, /\b8\.\s*use/i, /use[-\s]?case/i,
    /actor/i, /user\s+scenario/i
  ]
};

// ── Clean a single requirement line ──────────────────────────
function cleanLine(text) {
  return text
    .replace(/^[\d]+[\.\)]\s*/, "")     // remove "1. " or "1) "
    .replace(/^[•\-\*]\s*/, "")          // remove bullets
    .replace(/^(FR|NFR|DC|EI|SR|UC)[-\d]+[\.:]\s*/i, "") // remove FR1: etc
    .replace(/\s+/g, " ")
    .trim();
}

// ── Detect which section a heading line belongs to ────────────
function detectSection(line) {
  const lower = line.toLowerCase();
  for (const [key, patterns] of Object.entries(SECTION_PATTERNS)) {
    if (patterns.some(p => p.test(lower))) return key;
  }
  return null;
}

// ── Parse raw text into structured sections ───────────────────
function parseTextToSections(rawText) {
  const sections = {
    functional_requirements: [],
    performance_requirements: [],
    design_constraints: [],
    external_interfaces: [],
    security_requirements: [],
    use_cases: []
  };

  const lines = rawText.split(/\r?\n/);
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) continue;

    // Check if this line is a section heading
    const detected = detectSection(trimmed);
    if (detected) {
      currentSection = detected;
      continue;
    }

    // Add to current section if it looks like a requirement
    if (currentSection && trimmed.length > 15) {
      const cleaned = cleanLine(trimmed);
      // Filter out obvious non-requirements (page numbers, headers, etc.)
      if (
        cleaned.length > 15 &&
        !/^page\s+\d+/i.test(cleaned) &&
        !/^table\s+of/i.test(cleaned) &&
        !/^\d+$/.test(cleaned)
      ) {
        sections[currentSection].push(cleaned);
      }
    }
  }

  return sections;
}

// ── Parse PDF buffer ──────────────────────────────────────────
export async function parsePDF(buffer) {
  try {
    // Dynamic import to handle ESM
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const data = await pdfParse(buffer);
    const sections = parseTextToSections(data.text);
    return {
      title: extractTitle(data.text),
      domain: "web_application",
      sections,
      raw_text: data.text,
      source: "pdf"
    };
  } catch (e) {
    throw new Error(`PDF parsing failed: ${e.message}`);
  }
}

// ── Parse DOCX buffer ─────────────────────────────────────────
export async function parseDOCX(buffer) {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    const sections = parseTextToSections(result.value);
    return {
      title: extractTitle(result.value),
      domain: "web_application",
      sections,
      raw_text: result.value,
      source: "docx"
    };
  } catch (e) {
    throw new Error(`DOCX parsing failed: ${e.message}`);
  }
}

// ── Parse plain TXT ───────────────────────────────────────────
export function parseTXT(buffer) {
  const text = buffer.toString("utf8");
  const sections = parseTextToSections(text);
  return {
    title: extractTitle(text),
    domain: "web_application",
    sections,
    raw_text: text,
    source: "txt"
  };
}

// ── Parse JSON (existing format) ──────────────────────────────
export function parseJSON(buffer) {
  try {
    const data = JSON.parse(buffer.toString("utf8"));
    // Already structured
    if (data.sections) return { ...data, source: "json" };
    // Flat JSON - try to extract sections
    return {
      title: data.title || "Uploaded SRS",
      domain: data.domain || "web_application",
      sections: data,
      source: "json"
    };
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
}

// ── Extract title from first few lines ───────────────────────
function extractTitle(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 5);
  // Look for title-like line in first 10 lines
  for (const line of lines.slice(0, 10)) {
    if (
      line.length > 10 &&
      line.length < 100 &&
      !/^(table|figure|page|section|\d+\.)/i.test(line)
    ) {
      return line;
    }
  }
  return "Uploaded SRS Document";
}

// ── Main parse dispatcher ─────────────────────────────────────
export async function parseDocument(buffer, mimetype, originalname) {
  const ext = path.extname(originalname).toLowerCase();

  if (ext === ".pdf" || mimetype === "application/pdf") {
    return await parsePDF(buffer);
  }
  if (
    ext === ".docx" ||
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return await parseDOCX(buffer);
  }
  if (ext === ".txt" || mimetype === "text/plain") {
    return parseTXT(buffer);
  }
  if (ext === ".json" || mimetype === "application/json") {
    return parseJSON(buffer);
  }

  throw new Error(`Unsupported file type: ${ext}. Use PDF, DOCX, TXT, or JSON.`);
}