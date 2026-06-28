import { semanticSimilarity, rougeL, coveragePercent } from "./evaluator.js";
import { llmJudge, SECTION_KEYS } from "./generator.js";

// ── Gap 1 & 7: Full custom weight system ─────────────────────
// Metric weights: how much each of the 4 pipeline metrics contributes
const METRIC_WEIGHTS = {
  web_application: { semantic: 0.30, rouge: 0.20, coverage: 0.25, quality: 0.25 },
  healthcare:      { semantic: 0.25, rouge: 0.15, coverage: 0.25, quality: 0.35 },
  fintech:         { semantic: 0.25, rouge: 0.15, coverage: 0.25, quality: 0.35 },
  embedded:        { semantic: 0.20, rouge: 0.15, coverage: 0.30, quality: 0.35 }
};

// Gap 1: LLM judge criteria weights — what paper NEVER had
// How much each of 4 LLM quality criteria contributes to quality score
const CRITERIA_WEIGHTS = {
  web_application: { unambiguous: 0.25, understandable: 0.30, correct: 0.25, verifiable: 0.20 },
  healthcare:      { unambiguous: 0.20, understandable: 0.20, correct: 0.25, verifiable: 0.35 }, // verifiability critical
  fintech:         { unambiguous: 0.20, understandable: 0.20, correct: 0.25, verifiable: 0.35 }, // same as healthcare
  embedded:        { unambiguous: 0.15, understandable: 0.15, correct: 0.30, verifiable: 0.40 }  // correctness + verifiability critical
};

export const SECTION_LABELS = {
  functional_requirements:  "Functional Requirements",
  performance_requirements: "Performance Requirements",
  design_constraints:       "Design Constraints",
  external_interfaces:      "External Interfaces",
  security_requirements:    "Security Requirements",
  use_cases:                "Use Cases"
};

function bestMatch(genList, expList, genIdx) {
  const ratio = genIdx / Math.max(genList.length - 1, 1);
  const expIdx = Math.min(Math.round(ratio * (expList.length - 1)), expList.length - 1);
  return expList[expIdx] || expList[0];
}

// Gap 7: Accept custom weights from user (overrides domain defaults)
async function scoreSection(key, generated, expert, domain, customWeights = null) {
  const mw = customWeights?.metrics || METRIC_WEIGHTS[domain] || METRIC_WEIGHTS.web_application;
  const cw = customWeights?.criteria || CRITERIA_WEIGHTS[domain] || CRITERIA_WEIGHTS.web_application;

  const [sem, rouge, coverage] = await Promise.all([
    semanticSimilarity(generated, expert),
    Promise.resolve(rougeL(generated, expert)),
    coveragePercent(generated, expert)
  ]);

  // LLM judge — sample up to 4 reqs
  const sample = generated.slice(0, 4);
  const judgeScores = await Promise.all(
    sample.map((req, i) => llmJudge(req, bestMatch(generated, expert, i)))
  );

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  // Gap 1: weighted criteria score instead of simple average
  const criteriaAvgs = {
    unambiguous:    +avg(judgeScores.map(s => s.unambiguous)).toFixed(3),
    understandable: +avg(judgeScores.map(s => s.understandable)).toFixed(3),
    correct:        +avg(judgeScores.map(s => s.correct)).toFixed(3),
    verifiable:     +avg(judgeScores.map(s => s.verifiable)).toFixed(3)
  };

  // Weighted quality score using criteria weights
  const weightedQuality = (
    criteriaAvgs.unambiguous    * cw.unambiguous +
    criteriaAvgs.understandable * cw.understandable +
    criteriaAvgs.correct        * cw.correct +
    criteriaAvgs.verifiable     * cw.verifiable
  );

  // Final weighted score
  const weighted = (
    sem              * mw.semantic +
    rouge            * mw.rouge +
    (coverage / 100) * mw.coverage +
    (weightedQuality / 5) * mw.quality
  ) * 100;

  return {
    section:             SECTION_LABELS[key] || key,
    semantic_similarity: sem,
    rouge_l:             rouge,
    coverage_percent:    coverage,
    llm_quality_score:   +weightedQuality.toFixed(3),
    weighted_score:      +weighted.toFixed(2),
    unambiguous:         criteriaAvgs.unambiguous,
    understandable:      criteriaAvgs.understandable,
    correct:             criteriaAvgs.correct,
    verifiable:          criteriaAvgs.verifiable,
    req_count_generated: generated.length,
    req_count_expert:    expert.length,
    criteria_weights:    cw,
    metric_weights:      mw
  };
}

export async function runFullEvaluation(generatedSRS, expertSRS, domain, customWeights = null) {
  const genSections = generatedSRS.sections || generatedSRS;
  const expSections = expertSRS.sections   || expertSRS;
  const sectionScores = [];

  for (const key of SECTION_KEYS) {
    const gen = genSections[key] || [];
    const exp = expSections[key] || [];
    if (!gen.length && !exp.length) continue;
    const score = await scoreSection(key, gen, exp, domain, customWeights);
    sectionScores.push(score);
  }

  const avg = field =>
    +(sectionScores.reduce((a, s) => a + s[field], 0) / sectionScores.length).toFixed(4);

  return {
    section_scores:         sectionScores,
    overall_weighted_score: avg("weighted_score"),
    overall_semantic:       avg("semantic_similarity"),
    overall_rouge_l:        avg("rouge_l"),
    overall_coverage:       avg("coverage_percent"),
    overall_quality:        avg("llm_quality_score"),
    domain,
    custom_weights_used:    !!customWeights
  };
}