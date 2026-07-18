/**
 * Written-answer grading via Gemini API.
 * Mirrors the grading logic from written-engine.js.
 */

import type { WrittenEvaluation } from "./storage";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const GRADING_MODELS = [
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite (default, fast & modern)"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash (latest, strongest Flash)"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview (most capable, premium)"],
  ["gemma-4-26b-a4b-it", "Gemma 4 26B IT (open model, strong & free)"],
  ["gemma-4-31b-it", "Gemma 4 31B IT (larger open model)"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash (older fallback)"],
] as const;

const SYSTEM_PROMPT = [
  "You are an expert medical education grading assistant. Your role is to evaluate student written exam answers fairly, consistently, and constructively.",
  "",
  "# GRADING PHILOSOPHY",
  "This is a formative LEARNING TOOL, not a high-stakes summative exam. You are a generous grader.",
  "Core rule: when uncertain whether the student has covered a point, give them the benefit of the doubt.",
  "Partial understanding is valuable and must be rewarded.",
  "",
  "# OUTPUT REQUIREMENTS",
  "You MUST respond with a single raw JSON object and absolutely nothing else.",
  "No markdown fences, no backticks, no preamble, no explanation, no trailing text.",
  'The JSON object must contain exactly these keys:',
  '  "score"         : integer 0–100, or null if the answer cannot be assessed at all',
  '  "passed"        : boolean — true when final score >= 45',
  '  "strengths"     : array of strings, minimum 2 items; name specific things the student got right',
  '  "gaps"          : array of strings; missing points phrased constructively ("Could also mention…"); use [] if fully correct',
  '  "feedback"      : string; 1–2 sentences of encouraging, personalised advice',
  "",
  "# GRADING METHODOLOGY — FOLLOW THESE STEPS IN ORDER",
  "Step 1. Decompose the model answer into N distinct key points.",
  "Step 2. For each key point, determine whether the student covered it. Accept synonyms, paraphrases, and clinical equivalents.",
  "Step 3. Compute raw score = (number of covered key points ÷ N) × 100.",
  "Step 4. Round the raw score UP to the nearest multiple of 5.",
  "Step 5. Apply a GENEROSITY BONUS of +5 points, capped at 100.",
  "Step 6. Set passed = true if final score >= 45.",
  "",
  "# NEVER PENALISE",
  "• Paraphrasing or using simpler language that conveys the same meaning",
  "• Reordering list items",
  "• Including additional correct information not in the model answer",
  "• Minor spelling errors",
  "• Missing obscure details from a long comprehensive model answer",
  "• Using clinically accepted abbreviations or acronyms",
  "• Writing in bullet points or numbered lists instead of prose",
  "",
  "# FIELD GUIDANCE",
  "strengths: Be concrete and specific — reference the student's actual wording.",
  "gaps: Frame constructively — 'Could also mention…', 'A stronger answer would include…'.",
  "feedback: Open with a positive observation, then point to what to review. Keep under 60 words.",
].join("\n");

export function getGradingModels() {
  return GRADING_MODELS;
}

const STORAGE_KEYS = {
  apiKey: "osler_gemini_api_key",
  model: "osler_gemini_model",
} as const;

export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEYS.apiKey) || "";
}

export function setApiKey(key: string) {
  localStorage.setItem(STORAGE_KEYS.apiKey, key);
}

export function clearApiKey() {
  localStorage.removeItem(STORAGE_KEYS.apiKey);
}

export function getSelectedModel(): string {
  if (typeof window === "undefined") return GRADING_MODELS[0][0];
  return localStorage.getItem(STORAGE_KEYS.model) || GRADING_MODELS[0][0];
}

export function setSelectedModel(modelId: string) {
  localStorage.setItem(STORAGE_KEYS.model, modelId);
}

function buildUserPrompt(
  question: string,
  modelAnswer: string,
  rubric: string[],
  userAnswer: string,
): string {
  const parts = [
    "## QUESTION",
    question,
    "",
    "## MODEL ANSWER",
    modelAnswer || "(No model answer supplied.)",
    "",
  ];
  if (rubric && rubric.length > 0) {
    parts.push("## RUBRIC");
    parts.push(rubric.map((r, i) => `${i + 1}. ${r}`).join("\n"));
    parts.push("");
  }
  parts.push("## STUDENT'S ANSWER");
  parts.push(userAnswer);
  parts.push("");
  parts.push("Apply your grading methodology now and return the JSON object only.");
  return parts.join("\n");
}

function parseJsonResponse(text: string): Record<string, unknown> {
  const cleaned = String(text).trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const sliced = cleaned.slice(start, end + 1);
      try { return JSON.parse(sliced); } catch { /* fall through */ }
    }
    throw new Error("Could not parse Gemini response as JSON");
  }
}

function normalizeEvaluation(raw: Record<string, unknown>, source: string): WrittenEvaluation {
  let rawScore = raw.score;
  let score: number | null;
  if (rawScore === null || rawScore === undefined || rawScore === "" || rawScore === "N/A") {
    score = null;
  } else {
    const n = Number(rawScore);
    score = isFinite(n) ? n : null;
  }
  if (score !== null) score = Math.max(0, Math.min(100, Math.round(score)));

  let passed: boolean;
  if (typeof raw.passed === "boolean") {
    passed = raw.passed;
  } else if (score !== null) {
    passed = score >= 45;
  } else {
    passed = false;
  }

  const strengths = Array.isArray(raw.strengths)
    ? raw.strengths.map(String).filter(Boolean)
    : typeof raw.strengths === "string"
      ? raw.strengths.split("\n").map((s) => s.replace(/^[-*•]\s*/, "").trim()).filter(Boolean)
      : [];

  const gaps = Array.isArray(raw.gaps)
    ? raw.gaps.map(String).filter(Boolean)
    : typeof raw.gaps === "string"
      ? raw.gaps.split("\n").map((s) => s.replace(/^[-*•]\s*/, "").trim()).filter(Boolean)
      : [];

  const feedback = raw.feedback ? String(raw.feedback).trim() : "Review the model answer and adjust your final mark if needed.";

  return { score, passed, strengths, gaps, feedback, source };
}

export interface GradeOptions {
  question: string;
  modelAnswer?: string;
  rubric?: string[];
  userAnswer: string;
  signal?: AbortSignal;
  onProgress?: (model: string) => void;
}

export async function gradeWithAI(options: GradeOptions): Promise<WrittenEvaluation> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No Gemini API key saved.");
  const model = getSelectedModel();

  const userPrompt = buildUserPrompt(
    options.question,
    options.modelAnswer || "",
    options.rubric || [],
    options.userAnswer,
  );

  // Try selected model first, then fall back to default
  const attempts = [
    { model, jsonMode: true },
    { model, jsonMode: false },
  ];
  if (model !== GRADING_MODELS[0][0]) {
    attempts.push({ model: GRADING_MODELS[0][0], jsonMode: true });
    attempts.push({ model: GRADING_MODELS[0][0], jsonMode: false });
  }

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    if (options.signal?.aborted) throw new DOMException("Grading cancelled.", "AbortError");
    try {
      options.onProgress?.(attempt.model);
      const result = await callGemini(userPrompt, apiKey, attempt.model, attempt.jsonMode, options.signal);
      return normalizeEvaluation(result, `Gemini ${attempt.model}${attempt.jsonMode ? "" : " (compat)"}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.name === "AbortError") throw lastError;
    }
  }
  throw lastError || new Error("All grading attempts failed.");
}

async function callGemini(
  userPrompt: string,
  apiKey: string,
  model: string,
  jsonMode: boolean,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: userPrompt }] }],
  };

  const genConfig: Record<string, unknown> = { temperature: 0.1 };
  if (jsonMode) {
    genConfig.responseMimeType = "application/json";
    genConfig.responseSchema = {
      type: "object",
      properties: {
        score: { type: "integer", nullable: true },
        passed: { type: "boolean" },
        strengths: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
        feedback: { type: "string" },
      },
      required: ["score", "passed", "strengths", "gaps", "feedback"],
    };
  }
  body.generationConfig = genConfig;

  const controller = new AbortController();
  const timeout = 30000; // 30s default
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const combinedSignal = signal
    ? combineSignals(signal, controller.signal)
    : controller.signal;

  try {
    const response = await fetch(
      `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: combinedSignal,
      },
    );

    const text = await response.text();
    let payload: Record<string, unknown> | null = null;
    try { payload = text ? JSON.parse(text) as Record<string, unknown> : null; } catch { /* ignore */ }

    if (!response.ok) {
      const msg = payload && (payload.error as Record<string, unknown>)?.message
        ? String((payload.error as Record<string, unknown>).message)
        : text;
      throw new Error(`Gemini ${model} returned HTTP ${response.status}: ${msg}`);
    }

    const candidateText = extractGeminiText(payload);
    return parseJsonResponse(candidateText);
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractGeminiText(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  try {
    const candidates = payload.candidates as Array<Record<string, unknown>> | undefined;
    if (!candidates || candidates.length === 0) return "";
    const content = candidates[0].content as Record<string, unknown> | undefined;
    if (!content) return "";
    const parts = content.parts as Array<Record<string, unknown>> | undefined;
    if (!parts || parts.length === 0) return "";
    return String(parts[0].text || "");
  } catch {
    return "";
  }
}

function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export function createManualEvaluation(userAnswer: string): WrittenEvaluation {
  const hasContent = (userAnswer || "").trim().length > 0;
  return {
    score: null,
    passed: hasContent,
    strengths: hasContent ? ["Answer attempted and ready for self review."] : [],
    gaps: hasContent ? [] : ["No answer was provided before self grading."],
    feedback: "Compare your response with the model answer, then choose Pass or Fail for the final mark.",
    source: "Manual grade",
  };
}

const TRANSCRIPTION_PROMPT = [
  "You are an OCR assistant. Transcribe ALL handwritten or printed text from this photo of a written answer.",
  "Return ONLY the raw transcribed text — no commentary, no markdown, no wrapping, no labels.",
  "If the photo contains multiple sections or numbered parts, separate them with blank lines.",
  "Preserve the student's original wording exactly. Do not correct spelling or grammar.",
].join("\n");

export interface TranscribeOptions {
  photoBase64: string;
  mimeType?: string;
  signal?: AbortSignal;
}

export async function transcribePhoto(options: TranscribeOptions): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No Gemini API key saved.");
  const model = getSelectedModel();

  const attempts = [model, GRADING_MODELS[0][0]];
  const unique = [...new Set(attempts)];

  let lastError: Error | null = null;
  for (const m of unique) {
    if (options.signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
    try {
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: TRANSCRIPTION_PROMPT }] },
        contents: [{
          parts: [
            { text: "Transcribe all text in this image:" },
            { inlineData: { mimeType: options.mimeType || "image/jpeg", data: options.photoBase64 } },
          ],
        }],
      };
      body.generationConfig = { temperature: 0 };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const combinedSignal = options.signal
        ? combineSignals(options.signal, controller.signal)
        : controller.signal;

      try {
        const response = await fetch(
          `${GEMINI_BASE}/models/${encodeURIComponent(m)}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body),
            signal: combinedSignal,
          },
        );
        const text = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let payload: Record<string, unknown> | null = null;
        try { payload = JSON.parse(text); } catch { /* ignore */ }
        const result = extractGeminiText(payload).trim();
        if (result) return result;
        throw new Error("Empty transcription response");
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.name === "AbortError") throw lastError;
    }
  }
  throw lastError || new Error("Transcription failed on all models.");
}
