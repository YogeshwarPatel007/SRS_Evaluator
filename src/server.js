import express from "express";
import cors from "cors";
import multer from "multer";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { generateSRS, refineSection } from "./services/generator.js";
import { runFullEvaluation } from "./services/scorer.js";
import { parseDocument } from "./services/parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPERT_DIR = join(__dirname, "../data/expert_srs");
const PUBLIC_DIR = join(__dirname, "../public");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(PUBLIC_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = [".pdf", ".docx", ".txt", ".json"];
    const ext = "." + file.originalname.split(".").pop().toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Only PDF, DOCX, TXT, JSON files are allowed"));
  }
});

// ── Health ────────────────────────────────────────────────────
app.get("/api/health", (_, res) => {
  res.json({ status: "ok", message: "SRS Evaluator API running" });
});

// ── List expert SRS ───────────────────────────────────────────
app.get("/api/expert-srs", (_, res) => {
  try {
    const files = readdirSync(EXPERT_DIR).filter(f => f.endsWith(".json"));
    const options = files.map(f => {
      const data = JSON.parse(readFileSync(join(EXPERT_DIR, f), "utf8"));
      return { filename: f, title: data.title, domain: data.domain };
    });
    res.json({ options });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/expert-srs/:filename", (req, res) => {
  try {
    const data = JSON.parse(readFileSync(join(EXPERT_DIR, req.params.filename), "utf8"));
    res.json({ success: true, srs: data });
  } catch { res.status(404).json({ error: "Expert SRS not found" }); }
});

// ── Upload expert SRS (PDF/DOCX/TXT/JSON) ────────────────────
app.post("/api/upload-expert", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const parsed = await parseDocument(req.file.buffer, req.file.mimetype, req.file.originalname);
    const totalReqs = Object.values(parsed.sections).reduce((s, a) => s + a.length, 0);
    res.json({
      success: true, srs: parsed,
      stats: {
        total_requirements: totalReqs,
        sections_found: Object.entries(parsed.sections)
          .filter(([, v]) => v.length > 0)
          .map(([k, v]) => ({ section: k, count: v.length }))
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Gap 3: Generate with prompt strategy ─────────────────────
app.post("/api/generate", async (req, res) => {
  const { description, domain = "web_application", strategy = "standard" } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: "Description required" });
  try {
    const srs = await generateSRS(description, domain, strategy);
    res.json({ success: true, srs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Gap 1 & 7: Compare with custom weights ───────────────────
app.post("/api/compare", async (req, res) => {
  const { generated_srs, expert_srs, domain = "web_application", custom_weights = null } = req.body;
  if (!generated_srs || !expert_srs) return res.status(400).json({ error: "Both SRS required" });
  try {
    const result = await runFullEvaluation(generated_srs, expert_srs, domain, custom_weights);
    res.json({ success: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Gap 4: Refine a section based on feedback ─────────────────
app.post("/api/refine", async (req, res) => {
  const { section_key, requirements, feedback, description } = req.body;
  if (!section_key || !requirements || !feedback)
    return res.status(400).json({ error: "section_key, requirements and feedback required" });
  try {
    const refined = await refineSection(section_key, requirements, feedback, description || "");
    res.json({ success: true, refined_requirements: refined });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Full pipeline ─────────────────────────────────────────────
app.post("/api/pipeline", async (req, res) => {
  const { description, domain = "web_application", expert_filename,
          strategy = "standard", custom_weights = null } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: "Description required" });

  try {
    const generatedSRS = await generateSRS(description, domain, strategy);

    let expertFile = expert_filename;
    if (!expertFile) {
      const files = readdirSync(EXPERT_DIR).filter(f => f.endsWith(".json"));
      expertFile = files.find(f => f.includes(domain.replace("_", ""))) || files[0];
    }
    if (!expertFile) return res.status(404).json({ error: "No expert SRS found" });

    const expertSRS = JSON.parse(readFileSync(join(EXPERT_DIR, expertFile), "utf8"));
    const result = await runFullEvaluation(generatedSRS, expertSRS, domain, custom_weights);

    res.json({ success: true, generated_srs: generatedSRS, expert_srs: expertSRS, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("*", (_, res) => res.sendFile(join(PUBLIC_DIR, "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ SRS Evaluator running at http://localhost:${PORT}`);
  console.log(`📋 Open http://localhost:${PORT} in your browser\n`);
});