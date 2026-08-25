import * as React from "react";
import { resolveContentAsset } from "@/lib/osler/richtext";
import type { OsceStation, OsceDataImage, OsceExaminer } from "@/lib/osler/types";
export const MODELS: [string, string][] = [
  ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite (default, fastest & cost-efficient)"],
  ["gemini-3.7-flash", "Gemini 3.7 Flash (newest, most capable Flash)"],
  ["gemini-3.6-flash", "Gemini 3.6 Flash (fast & efficient)"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash (stable, high-throughput)"],
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite (fast & modern)"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview (most capable, premium)"],
  ["gemini-3-flash-preview", "Gemini 3 Flash Preview (experimental)"],
  ["gemma-4-26b-a4b-it", "Gemma 4 26B IT (open model, strong & free)"],
  ["gemma-4-31b-it", "Gemma 4 31B IT (larger open model)"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite (budget fallback)"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash (older fallback)"],
];

export const LIVE_MODELS: [string, string][] = [
  // Live API is now the default — the user requested Gemini Live as the
  // primary voice path, with server-side transcriptions as an opt-in.
  ["gemini-3.1-flash-live-preview", "Gemini 3.1 Flash Live (default, recommended)"],
  ["gemini-2.5-flash-native-audio-preview-12-2025", "Gemini 2.5 Flash Live — native audio"],
];

export const MAX_TURNS = 30;
export const WARN_TURNS = 25;
export const EXAM_TIME = 480;

export const STORAGE = {
  progress: "osler_osce_progress_",
  session: "osler_osce_session_",
  voiceOn: "osler_osce_voice_on",
  ttsVoice: "osler_osce_tts_voice",
  ttsRate: "osler_osce_tts_rate",
  // Opt-in: when true, the Gemini Live `setup` message requests server-side
  // input/output audio transcription. Default is OFF — this matches the
  // ChatGPT-voice-style UX where the conversation is purely audio and the
  // transcript is a deliberate choice (saves Live API quota / latency).
  liveTranscripts: "osler_osce_live_transcripts",
} as const;

export const API_KEY = "osler_gemini_api_key";
export const API_MODEL = "osler_gemini_model";
export const API_MAX_WAIT = "osler_gemini_max_wait";
export const LIVE_MODEL_KEY = "osler_osce_live_model";

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const MAP_STEPS: [string, string][] = [
  ["Opening", "Intro & consent"],
  ["History", "Chief complaint"],
  ["Background", "PMH, meds, social"],
  ["ICE", "Concerns & expectations"],
  ["Closing", "Summarise & safety"],
];

/* ── Helpers ────────────────────────────────────────────────────────── */

export function textOr(v: unknown, fallback: string): string {
  return v == null || v === "" ? fallback : String(v);
}

export function pickField(obj: Record<string, unknown>, ...fields: string[]): unknown {
  for (const f of fields) {
    const v = obj[f];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sc = s % 60;
  return m + ":" + (sc < 10 ? "0" : "") + sc;
}

export function timerState(s: number): "ok" | "warn" | "danger" {
  return s > 120 ? "ok" : s > 30 ? "warn" : "danger";
}

export function diffClass(d: string): string {
  const l = d.toLowerCase();
  return l.includes("found") || l === "easy"
    ? "border-success/30 text-success bg-success-soft"
    : l.includes("adv") || l === "hard"
    ? "border-destructive/30 text-destructive bg-destructive-soft"
    : "border-warning/30 text-warning bg-warning-soft";
}

export function userTurnCount(transcript: TranscriptEntry[]): number {
  let c = 0;
  for (const m of transcript) if (m.role === "user") c++;
  return c;
}

export function sanitizeModelText(text: string): string {
  return text
    .replace(/This response is not intended to be medical advice[^.]*(?:consult|professional|treatment)[^.]*\./gi, "")
    .trim();
}

export function isPediatric(age: number): boolean {
  return age < 16;
}

/* ── Normalization ─────────────────────────────────────────────────── */

export function normalizeStation(raw: Record<string, unknown>, idx: number): OsceStation {
  raw = raw || {};
  const patient = (raw.patient as Record<string, unknown>) || {};
  const hidden = (raw.hiddenProfile || raw.hidden_profile || {}) as Record<string, unknown>;
  const rubric = (raw.rubric || {}) as Record<string, unknown>;
  const type = (String(raw.type || "history")).toLowerCase();
  return {
    id: textOr(pickField(raw, "id"), "case-" + (idx + 1)),
    title: textOr(pickField(raw, "title", "name"), "Case " + (idx + 1)),
    type: type === "data-interp" ? "data-interp" : "history",
    specialty: textOr(pickField(raw, "specialty", "category"), "General"),
    difficulty: textOr(pickField(raw, "difficulty", "level"), "Intermediate"),
    task: textOr(
      pickField(raw, "task", "instructions"),
      type === "data-interp"
        ? "Interpret the data and answer the examiner's questions."
        : "Take a focused history from this patient."
    ),
    time: Number(pickField(raw, "time")) || EXAM_TIME,
    examiner: (raw.examiner || { name: "Examiner", title: "Consultant" }) as OsceExaminer,
    dataPresented: (raw.dataPresented || null) as OsceStation["dataPresented"],
    questions: Array.isArray(raw.questions) ? (raw.questions as OsceStation["questions"]) : [],
    patient: {
      name: textOr(pickField(patient, "name", "displayName"), "Patient"),
      age: Number(pickField(patient, "age")) || 40,
      gender:
        (pickField(patient, "gender", "sex") || "male") === "female" ? "female" : "male",
      avatarSeed: textOr(pickField(patient, "avatarSeed", "avatar_seed"), "osce-" + idx),
      opening: textOr(
        pickField(patient, "opening", "greeting"),
        "Hello doctor, thank you for seeing me."
      ),
    },
    hiddenProfile: {
      diagnosis: textOr(hidden.diagnosis, ""),
      keySymptoms: Array.isArray(hidden.keySymptoms || hidden.key_symptoms)
        ? ((hidden.keySymptoms || hidden.key_symptoms) as string[])
        : [],
      redFlags: Array.isArray(hidden.redFlags || hidden.red_flags)
        ? ((hidden.redFlags || hidden.red_flags) as string[])
        : [],
      pastHistory: Array.isArray(hidden.pastHistory || hidden.past_history)
        ? ((hidden.pastHistory || hidden.past_history) as string[])
        : [],
      vitalSigns: textOr(hidden.vitalSigns || hidden.vital_signs, ""),
    },
    rubric: {
      mustAsk: Array.isArray(rubric.mustAsk || rubric.must_ask)
        ? ((rubric.mustAsk || rubric.must_ask) as string[])
        : [],
      bonus: Array.isArray(rubric.bonus) ? (rubric.bonus as string[]) : [],
    },
  };
}

/* ── Prompt Builders ───────────────────────────────────────────────── */

export function buildPatientSysPrompt(c: OsceStation): string {
  const p = c.patient;
  const hp = c.hiddenProfile;
  const isPed = isPediatric(p.age);
  const speakerLabel = isPed
    ? `You are the ${p.gender === "female" ? "Mother" : "Father"} of ${p.name}, age ${p.age}. You are speaking on behalf of your child.`
    : `You are ${p.name}, age ${p.age}. You are seeing the doctor today.`;
  return [
    "You are role-playing a virtual patient in an OSCE clinical-skills exam for medical students.",
    "Stay in character at all times.",
    "",
    "# YOUR IDENTITY",
    speakerLabel,
    "",
    "# THE PATIENT'S TRUE (HIDDEN) CLINICAL PICTURE",
    "• Main symptoms: " + (hp.keySymptoms.join("; ") || "(as below)"),
    "• Red-flag / associated features: " + (hp.redFlags.join("; ") || "(none notable)"),
    "• Past medical history: " + (hp.pastHistory.join("; ") || "(unremarkable)"),
    "• Vital signs (reveal only if asked): " + (hp.vitalSigns || "(normal)"),
    "",
    "# ROLE-PLAY RULES",
    "1. Answer only what the student asks. Do NOT recite a textbook.",
    "2. Reveal symptoms gradually and only when specifically questioned.",
    "3. MUST NOT name the diagnosis or give medical terminology.",
    "4. If asked something not given, say you do not know.",
    "5. Keep replies to 1-3 short sentences in plain language.",
    "6. Show emotion consistent with the complaint but do not over-act.",
    "7. Never break character, never mention being an AI.",
    "8. NEVER include medical disclaimers.",
    "9. Reply in the SAME language the student uses (Arabic, English, or a mix). If they code-switch, mirror their mix naturally; clinical terms may stay in English.",
  ].join("\n");
}

export function buildExaminerSysPrompt(): string {
  return [
    "You are an expert OSCE examiner scoring a medical student's patient-interview transcript.",
    "Respond with a single raw JSON object and absolutely nothing else. No markdown, no fences.",
    "The JSON object must contain exactly these keys:",
    '  "score"      : integer 0-100 (overall, rounded to nearest 5)',
    '  "passed"     : boolean',
    '  "domains"    : { "communication": 0-25, "infoGathering": 0-25, "clinicalReasoning": 0-25, "professionalism": 0-25 }',
    '  "asked"      : array of strings',
    '  "missed"     : array of strings',
    '  "feedback"   : string — 2-3 sentences',
    "",
    "Each mustAsk item covered ≈ a large share of the score. Credit paraphrases.",
    'Write "feedback" in the language the student used most; keep "asked"/"missed" items in the rubric\'s wording.',
    "Domain scores should sum to approximately the overall score.",
  ].join("\n");
}

export function buildExaminerUserPrompt(c: OsceStation, transcript: TranscriptEntry[]): string {
  const rubric = c.rubric;
  const lines: string[] = [];
  lines.push("CASE: " + c.title);
  lines.push("CASE TASK: " + c.task);
  lines.push("MUST-ASK CRITERIA:");
  (rubric.mustAsk || []).forEach((m, i) => lines.push("  " + (i + 1) + ". " + m));
  if (rubric.bonus && rubric.bonus.length) {
    lines.push("BONUS CRITERIA:");
    rubric.bonus.forEach((m, i) => lines.push("  " + (i + 1) + ". " + m));
  }
  lines.push("");
  lines.push("INTERVIEW TRANSCRIPT (user = student, model = patient):");
  transcript.forEach((t) => lines.push((t.role === "user" ? "Student: " : "Patient: ") + t.text));
  lines.push("");
  lines.push("Score this transcript. Return JSON only.");
  return lines.join("\n");
}

export function buildDataInterpSysPrompt(c: OsceStation): string {
  const e = c.examiner || { name: "Examiner", title: "Consultant" };
  const dp = c.dataPresented || {};
  const lines: string[] = [
    "You are " + e.name + ", " + e.title + ", an expert medical examiner conducting an oral OSCE-style data-interpretation examination.",
    "",
    "1. Present yourself and the clinical case. In your opening, name each printed material by its title (e.g. \"I've placed the ECG on the desk — take a moment to look at it\") so the student knows what to reference.",
    "2. Ask the student questions one at a time, referring to the printed materials by name (e.g. \"Take a look at the ECG — what do you see?\"). Wait for their answer.",
    "3. Be warm, professional, and encouraging. Give positive reinforcement.",
    "4. If the student struggles, offer gentle hints. Never give the answer away immediately.",
    "5. NEVER break character, never mention being an AI.",
    "6. Do NOT summarise performance at the end. Evaluation happens after.",
    "7. Never read out the findings in the images directly — quiz the student on them.",
    "",
    "CASE: " + c.title + " (" + c.specialty + ", " + c.difficulty + ")",
  ];
  if (dp.scenario) lines.push("SCENARIO: " + dp.scenario);
  const tables = dp.tables || [];
  if (tables.length) {
    tables.forEach((t) => {
      if (t.title) lines.push("--- " + t.title + " ---");
      if (t.headers) lines.push("  | " + t.headers.join(" | ") + " |");
      (t.rows || []).forEach((r) => lines.push("  | " + r.join(" | ") + " |"));
    });
  }
  const images = dp.images || [];
  if (images.length) {
    lines.push("PRINTED MATERIALS (the student has these images):");
    images.forEach((im, i) => {
      lines.push((i + 1) + ". " + (im.title || "Image " + (i + 1)));
      if (im.caption) lines.push("   " + im.caption);
    });
  }
  const questions = c.questions || [];
  if (questions.length) {
    lines.push("QUESTIONS (ask in order):");
    questions.forEach((q, qi) => {
      lines.push((qi + 1) + ". " + q.question);
      if (q.answer) lines.push("   Model answer: " + q.answer);
    });
  }
  lines.push(
    "Match the student's language exactly (Arabic, English, or their natural mix). Clinical terms stay in English.",
    "Keep a mental score out of 100. Do NOT share it."
  );
  return lines.join("\n");
}

export function buildDataInterpScoreSysPrompt(): string {
  return [
    "You are an expert medical examiner scoring a student's data-interpretation OSCE.",
    "Respond with a single raw JSON object. No markdown, no fences.",
    'The JSON must contain: "score" (0-100), "passed" (bool),',
    '"domains": { "knowledge": 0-30, "interpretation": 0-30, "reasoning": 0-25, "communication": 0-15 },',
    '"asked" (string[]), "missed" (string[]), "feedback" (string).',
    "Mixing Arabic and English is normal. Do NOT penalise code-switching.",
    'Write "feedback" in the language the student used most.',
  ].join("\n");
}

export function buildDataInterpScoreUserPrompt(c: OsceStation, transcript: TranscriptEntry[]): string {
  const lines = ["CASE: " + c.title, "SPECIALTY: " + c.specialty, ""];
  const dp = c.dataPresented || {};
  if (dp.scenario) lines.push("SCENARIO: " + dp.scenario);
  const images = dp.images || [];
  if (images.length) {
    lines.push("PRINTED MATERIALS:");
    images.forEach((im) => {
      if (im.title) lines.push("- " + im.title);
      if (im.caption) lines.push("  " + im.caption);
    });
  }
  if (c.questions && c.questions.length) {
    lines.push("QUESTIONS:");
    c.questions.forEach((q, i) =>
      lines.push((i + 1) + ". " + q.question + (q.answer ? " [" + q.answer + "]" : ""))
    );
  }
  lines.push("", "TRANSCRIPT:");
  transcript.forEach((t) =>
    lines.push((t.role === "user" ? "Student: " : "Examiner: ") + t.text)
  );
  lines.push("", "Score this transcript. Return JSON only.");
  return lines.join("\n");
}

/* ── Scoring ───────────────────────────────────────────────────────── */

export interface DomainScores {
  [key: string]: number;
}

export interface ExamResult {
  score: number;
  passed: boolean;
  domains: DomainScores;
  asked: string[];
  missed: string[];
  feedback: string;
}

export function scoreRubric(raw: string): ExamResult | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    const score = Math.max(0, Math.min(100, parseInt(obj.score, 10)));
    if (isNaN(score)) return null;
    const d = obj.domains || {};
    return {
      score,
      passed: !!obj.passed,
      domains: {
        communication: Math.max(0, Math.min(25, parseInt(d.communication, 10) || 0)),
        infoGathering: Math.max(0, Math.min(25, parseInt(d.infoGathering || d.info_gathering, 10) || 0)),
        clinicalReasoning: Math.max(0, Math.min(25, parseInt(d.clinicalReasoning || d.clinical_reasoning, 10) || 0)),
        professionalism: Math.max(0, Math.min(25, parseInt(d.professionalism, 10) || 0)),
      },
      asked: Array.isArray(obj.asked) ? obj.asked.map(String) : [],
      missed: Array.isArray(obj.missed) ? obj.missed.map(String) : [],
      feedback: textOr(obj.feedback, ""),
    };
  } catch {
    return null;
  }
}

export function scoreDataInterp(raw: string): ExamResult | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    const score = Math.max(0, Math.min(100, parseInt(obj.score, 10)));
    if (isNaN(score)) return null;
    const d = obj.domains || {};
    return {
      score,
      passed: !!obj.passed,
      domains: {
        knowledge: Math.max(0, Math.min(30, parseInt(d.knowledge, 10) || 0)),
        interpretation: Math.max(0, Math.min(30, parseInt(d.interpretation, 10) || 0)),
        reasoning: Math.max(0, Math.min(25, parseInt(d.reasoning, 10) || 0)),
        communication: Math.max(0, Math.min(15, parseInt(d.communication, 10) || 0)),
      },
      asked: Array.isArray(obj.asked) ? obj.asked.map(String) : [],
      missed: Array.isArray(obj.missed) ? obj.missed.map(String) : [],
      feedback: textOr(obj.feedback, ""),
    };
  } catch {
    return null;
  }
}

/* ── API Helpers ───────────────────────────────────────────────────── */

export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(API_KEY) || "";
}

export function hasApiKey(): boolean {
  return !!getApiKey();
}

export function getModel(): string {
  if (typeof window === "undefined") return MODELS[0][0];
  return localStorage.getItem(API_MODEL) || MODELS[0][0];
}

export function getLiveModel(): string {
  return localStorage.getItem(LIVE_MODEL_KEY) || LIVE_MODELS[0][0];
}

export type GeminiInlineData = { mimeType: string; data: string };

export type GeminiPart =
  | { text: string }
  | { inlineData: GeminiInlineData };

export type GeminiContent = { role: string; parts: GeminiPart[] };

/** Resolve a printed-materials image to a displayable URL. */
export function dataImageUrl(im: OsceDataImage, packPath: string): string {
  if (im.data) return im.data.startsWith("data:") ? im.data : `data:image/png;base64,${im.data}`;
  if (im.url) return im.url;
  if (im.src) return resolveContentAsset(im.src, "osce", packPath);
  return "";
}

/** Base64-encode an image URL (or pass through a data: URI) for Gemini vision. */
export async function fetchInlineData(url: string): Promise<GeminiInlineData | null> {
  if (url.startsWith("data:")) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(url);
    if (!m) return null;
    return { mimeType: m[1], data: m[2] };
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(blob);
    });
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!m) return null;
    return { mimeType: m[1], data: m[2] };
  } catch {
    return null;
  }
}

/** Build Gemini image parts for a data-interp station's printed materials. */
export async function printedImageParts(
  images: OsceDataImage[] | undefined,
  packPath: string
): Promise<GeminiPart[]> {
  const parts: GeminiPart[] = [];
  for (const im of images ?? []) {
    const url = dataImageUrl(im, packPath);
    if (!url) continue;
    const inline = await fetchInlineData(url);
    if (inline) parts.push({ inlineData: inline });
  }
  return parts;
}

export async function callGemini(
  systemPrompt: string,
  contents: GeminiContent[],
  signal?: AbortSignal,
  onDelta?: (fullText: string) => void
): Promise<string> {
  const key = getApiKey();
  const model = getModel();
  if (!key) throw new Error("API key not configured");
  // streamGenerateContent + alt=sse yields token-level deltas so replies can
  // be painted as they are written instead of spawning in one block.
  const url = `${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${err.slice(0, 200)}`);
  }
  if (!res.body) {
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text) throw new Error("Empty response from Gemini");
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buf = "";
  // Mirrors @googleapis/js-genai's processStreamResponse(): SSE events are
  // `data: {json}` lines; a chunk may carry a top-level {"error": ...} whose
  // message must surface; and the final event can arrive without a trailing
  // newline, so the buffer is flushed after the read loop ends.
  const handleDataLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const json = line.slice(5).trim();
    if (!json) return;
    let chunk: {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    try {
      chunk = JSON.parse(json);
    } catch {
      return;
    }
    if (chunk && typeof chunk === "object" && chunk.error) {
      throw new Error(chunk.error.message || "Gemini stream error");
    }
    const parts = chunk?.candidates?.[0]?.content?.parts;
    const piece = Array.isArray(parts)
      ? parts.map((p) => p.text ?? "").join("")
      : "";
    if (piece) {
      full += piece;
      onDelta?.(full);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) handleDataLine(line.trim());
    }
    for (const line of buf.split("\n")) handleDataLine(line.trim());
  } finally {
    reader.releaseLock();
  }
  if (!full.trim()) throw new Error("Empty response from Gemini");
  return full;
}

export async function askPatient(
  c: OsceStation,
  transcript: TranscriptEntry[],
  signal?: AbortSignal,
  onDelta?: (fullText: string) => void
): Promise<string> {
  const contents = transcript.map((m) => ({
    role: m.role === "model" ? "model" : "user",
    parts: [{ text: m.text }],
  }));
  return callGemini(buildPatientSysPrompt(c), contents, signal, onDelta);
}

export async function askExaminer(
  c: OsceStation,
  transcript: TranscriptEntry[],
  signal?: AbortSignal,
  packPath = "",
  onDelta?: (fullText: string) => void
): Promise<string> {
  // The professor sees the printed materials the student was handed as a
  // leading context turn (vision via inlineData). It never appears in the
  // visible transcript — the model is told not to describe the images.
  const imageParts = await printedImageParts(c.dataPresented?.images, packPath);
  const context: GeminiPart[] = [
    ...imageParts,
    {
      text:
        "These are the printed materials the student has been handed. " +
        "You are the examiner. Present yourself and the case, then ask your " +
        "questions one at a time. Never describe the images themselves.",
    },
  ];
  const contents: GeminiContent[] = [{ role: "user", parts: context }].concat(
    transcript.map((m) => ({
      role: m.role === "model" ? "model" : "user",
      parts: [{ text: m.text }],
    }))
  );
  return callGemini(buildDataInterpSysPrompt(c), contents, signal);
}

export async function scoreInterview(c: OsceStation, transcript: TranscriptEntry[], signal?: AbortSignal): Promise<ExamResult> {
  const contents = [{ role: "user", parts: [{ text: buildExaminerUserPrompt(c, transcript) }] }];
  const raw = await callGemini(buildExaminerSysPrompt(), contents, signal);
  const cleaned = String(raw).replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();
  const parsed = scoreRubric(cleaned);
  if (!parsed) throw new Error("Examiner returned malformed feedback. Try again.");
  return parsed;
}

export async function scoreDataInterpExam(
  c: OsceStation,
  transcript: TranscriptEntry[],
  signal?: AbortSignal,
  packPath = ""
): Promise<ExamResult> {
  const imageParts = await printedImageParts(c.dataPresented?.images, packPath);
  const contents: GeminiContent[] = [
    { role: "user", parts: [{ text: buildDataInterpScoreUserPrompt(c, transcript) }, ...imageParts] },
  ];
  const raw = await callGemini(buildDataInterpScoreSysPrompt(), contents, signal);
  const cleaned = String(raw).replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();
  const parsed = scoreDataInterp(cleaned);
  if (!parsed) throw new Error("Examiner returned malformed feedback. Try again.");
  return parsed;
}
/* ── Types ─────────────────────────────────────────────────────────── */

export interface TranscriptEntry {
  role: "user" | "model";
  text: string;
}

export type OscePhase = "select" | "lobby" | "conversation" | "debrief";

export interface Achievement {
  icon: string;
  label: string;
  desc: string;
  color: "gold" | "green" | "blue" | "purple";
}