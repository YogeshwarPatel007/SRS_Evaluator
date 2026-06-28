import { pipeline } from "@xenova/transformers";

let embedder = null;

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return embedder;
}

// Cosine similarity between two vectors
function cosine(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
}

// Get mean pooled embedding for a sentence
async function embed(text, extractor) {
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

// ── 1. Semantic Similarity ────────────────────────────────────
export async function semanticSimilarity(generated, expert) {
  if (!generated.length || !expert.length) return 0;

  const ext = await getEmbedder();
  const genEmbs = await Promise.all(generated.map((r) => embed(r, ext)));
  const expEmbs = await Promise.all(expert.map((r) => embed(r, ext)));

  // For each generated req, find best matching expert req
  const scores = genEmbs.map((gEmb) => {
    const sims = expEmbs.map((eEmb) => cosine(gEmb, eEmb));
    return Math.max(...sims);
  });

  return +( scores.reduce((a, b) => a + b, 0) / scores.length ).toFixed(4);
}

// ── 2. ROUGE-L ────────────────────────────────────────────────
function lcs(a, b) {
  // Longest common subsequence length on word arrays
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  return dp[m][n];
}

export function rougeL(generated, expert) {
  if (!generated.length || !expert.length) return 0;

  const genText = generated.join(" ").toLowerCase().split(/\s+/);
  const expText = expert.join(" ").toLowerCase().split(/\s+/);

  const lcsLen = lcs(genText, expText);
  const precision = lcsLen / genText.length;
  const recall    = lcsLen / expText.length;
  if (precision + recall === 0) return 0;

  const f1 = (2 * precision * recall) / (precision + recall);
  return +f1.toFixed(4);
}

// ── 3. Coverage % ─────────────────────────────────────────────
export async function coveragePercent(generated, expert) {
  if (!expert.length) return 0;
  if (!generated.length) return 0;

  const THRESHOLD = 0.65;
  const ext = await getEmbedder();
  const genEmbs = await Promise.all(generated.map((r) => embed(r, ext)));
  const expEmbs = await Promise.all(expert.map((r) => embed(r, ext)));

  let covered = 0;
  for (const eEmb of expEmbs) {
    const sims = genEmbs.map((gEmb) => cosine(gEmb, eEmb));
    if (Math.max(...sims) >= THRESHOLD) covered++;
  }

  return +((covered / expert.length) * 100).toFixed(2);
}
