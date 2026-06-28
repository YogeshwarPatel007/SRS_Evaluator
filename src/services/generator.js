import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "llama-3.3-70b-versatile";

// ── Gap 3: Multiple prompt strategies ────────────────────────
// standard: direct instruction (what paper used)
// cot:      chain-of-thought (think step by step)
// fewshot:  few-shot with example requirement
// role:     role prompting (act as senior architect)

const STRATEGY_PREFIX = {
  standard: "",
  cot: "Think step by step before generating each requirement. First reason about what this system needs, then write the requirements.\n\n",
  fewshot: `Here is an example of a well-written requirement:
GOOD: "The system shall authenticate users via OAuth 2.0, supporting Google and Microsoft identity providers, with session tokens expiring after 8 hours of inactivity."
BAD:  "The system should have login."

Now apply the same quality standard to generate requirements for:\n\n`,
  role: "You are a senior software architect with 15 years of experience writing IEEE-compliant SRS documents for enterprise systems. Apply your expertise to generate precise, verifiable, unambiguous requirements.\n\n"
};

const SECTION_PROMPTS = {
  functional_requirements: `{prefix}Generate ONLY the Functional Requirements for this project.
Rules:
- Each requirement starts with "The system shall..."
- Be specific to this project, no generic placeholders
- Return ONLY a JSON array of strings, no explanation
- Aim for 8-10 requirements
Project: {description}
Return: ["requirement 1", "requirement 2", ...]`,

  performance_requirements: `{prefix}Generate ONLY the Performance Requirements with specific measurable thresholds.
Rules:
- Include real numbers (response time ms, concurrent users, uptime %)
- Each starts with "The system shall..."
- Return ONLY a JSON array of strings
- Aim for 2-4 requirements
Project: {description}
Return: ["requirement 1", ...]`,

  design_constraints: `{prefix}Generate ONLY the Design Constraints section.
Rules:
- Focus on technical/platform/regulatory limits that constrain design choices
- Be specific, avoid vague statements like "easy to maintain"
- Each starts with "The system shall..." or "The system must..."
- Return ONLY a JSON array of strings
- Aim for 3-5 constraints
Project: {description}
Return: ["constraint 1", ...]`,

  external_interfaces: `{prefix}Generate ONLY the External Interfaces section.
Rules:
- Describe each external API/system/service the system integrates with
- Include the specific interface name and purpose
- Each starts with "The system shall..."
- Return ONLY a JSON array of strings
- Aim for 2-4 interfaces
Project: {description}
Return: ["interface 1", ...]`,

  security_requirements: `{prefix}Generate ONLY the Security Requirements section.
Rules:
- Specify exact encryption standards (TLS 1.3, AES-256), auth mechanisms, access control
- Each must be verifiable and testable
- Each starts with "The system shall..."
- Return ONLY a JSON array of strings
- Aim for 3-5 requirements
Project: {description}
Return: ["requirement 1", ...]`,

  use_cases: `{prefix}Generate ONLY the Use Cases section.
Rules:
- Format each as: "Actor: [X]. Purpose: [Y]. Flow: [Z]"
- Cover the main user interactions
- Return ONLY a JSON array of strings
- Aim for 3-5 use cases
Project: {description}
Return: ["use case 1", ...]`
};

export const SECTION_KEYS = [
  "functional_requirements",
  "performance_requirements",
  "design_constraints",
  "external_interfaces",
  "security_requirements",
  "use_cases"
];

// Call Groq and parse JSON array response
async function callGroq(prompt) {
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 2048
  });

  let raw = response.choices[0].message.content.trim();
  if (raw.includes("```")) {
    const parts = raw.split("```");
    raw = parts[1] || parts[0];
    if (raw.startsWith("json")) raw = raw.slice(4);
  }
  raw = raw.trim();

  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return parsed.filter(r => typeof r === "string" && r.trim().length > 10);
    } catch {}
  }

  return raw
    .split("\n")
    .map(l => l.replace(/^[\d\.\-\*\"]+\s*/, "").trim())
    .filter(l => l.length > 15);
}

// ── Gap 3: Generate with chosen prompt strategy ───────────────
export async function generateSRS(description, domain = "web_application", strategy = "standard") {
  const prefix = STRATEGY_PREFIX[strategy] || STRATEGY_PREFIX.standard;
  const sections = {};

  for (const key of SECTION_KEYS) {
    const prompt = SECTION_PROMPTS[key]
      .replace("{prefix}", prefix)
      .replace("{description}", description);
    sections[key] = await callGroq(prompt);
  }

  const titleWords = description.trim().split(" ").slice(0, 7).join(" ");
  return { title: titleWords, domain, sections, strategy };
}

// ── Gap 4: Refinement — improve one section based on feedback ─
export async function refineSection(sectionKey, requirements, feedback, description) {
  const prompt = `You are a senior software engineer refining SRS requirements based on evaluation feedback.

Project: ${description}
Section: ${sectionKey.replace(/_/g, " ")}

Current requirements:
${requirements.map((r, i) => `${i+1}. ${r}`).join("\n")}

Evaluation feedback / issues found:
${feedback}

Instructions:
- Fix the issues identified in the feedback
- Keep requirements that are already good
- Make vague requirements specific and measurable
- Ensure all start with "The system shall..."
- Return ONLY a JSON array of improved requirement strings

Return: ["improved requirement 1", "improved requirement 2", ...]`;

  return await callGroq(prompt);
}

// ── LLM judge ─────────────────────────────────────────────────
export async function llmJudge(genReq, expertReq) {
  const prompt = `You are an expert SRS evaluator.
Compare the GENERATED requirement against the EXPERT requirement.
Score the GENERATED one on 4 criteria from 1 (poor) to 5 (excellent).

EXPERT: ${expertReq}
GENERATED: ${genReq}

Criteria:
- unambiguous: only one interpretation (1=very ambiguous, 5=crystal clear)
- understandable: easy for all stakeholders (1=confusing, 5=very clear)
- correct: accurately captures the feature (1=wrong, 5=fully correct)
- verifiable: can be tested cost-effectively (1=untestable, 5=clearly testable)

Return ONLY valid JSON, nothing else:
{"unambiguous": X, "understandable": X, "correct": X, "verifiable": X}`;

  try {
    const response = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 100
    });

    let raw = response.choices[0].message.content.trim();
    if (raw.includes("```")) {
      raw = raw.split("```")[1] || raw;
      if (raw.startsWith("json")) raw = raw.slice(4);
    }
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const scores = JSON.parse(match[0]);
      return {
        unambiguous:    Number(scores.unambiguous)    || 3,
        understandable: Number(scores.understandable) || 3,
        correct:        Number(scores.correct)        || 3,
        verifiable:     Number(scores.verifiable)     || 3
      };
    }
  } catch {}

  return { unambiguous: 3, understandable: 3, correct: 3, verifiable: 3 };
}