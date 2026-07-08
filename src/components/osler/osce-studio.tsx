"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  MicOff,
  Send,
  RotateCcw,
  Stethoscope,
  Clock,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Settings as SettingsIcon,
  Home,
  Activity,
  Lightbulb,
  RefreshCw,
  Volume2,
  VolumeX,
  Loader2,
  AlertCircle,
  Sun,
  Moon,
  AlignLeft,
  type LucideIcon,
} from "lucide-react";
import { loadContentByUid, loadAllContent } from "@/lib/osler/content";
import type {
  AnyContent,
  ManifestItem,
  OsceContent,
  OsceStation,
  OscePatient,
  OsceHiddenProfile,
  OsceRubric,
  OsceDataTable,
  OsceDataImage,
  OsceExaminer,
} from "@/lib/osler/types";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

/* ── Constants ─────────────────────────────────────────────────────── */

const MODELS: [string, string][] = [
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite (default, fast & modern)"],
  ["gemma-4-26b-a4b-it", "Gemma 4 26B IT (open model, strong & free)"],
  ["gemma-4-31b-it", "Gemma 4 31B IT (larger open model)"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash"],
];

const LIVE_MODELS: [string, string][] = [
  ["gemini-3.1-flash-live-preview", "Gemini 3.1 Flash Live (recommended)"],
  ["gemini-live-2.5-flash-native-audio", "Gemini Live 2.5 Flash — native audio"],
  ["gemini-live-2.5-flash-preview-native-audio-09-2025", "Gemini 2.5 Flash Live — native audio preview"],
];

const MAX_TURNS = 30;
const WARN_TURNS = 25;
const EXAM_TIME = 480;

const STORAGE = {
  progress: "osler_osce_progress_",
  session: "osler_osce_session_",
  voiceOn: "osler_osce_voice_on",
  ttsVoice: "osler_osce_tts_voice",
  ttsRate: "osler_osce_tts_rate",
} as const;

const API_KEY = "osler_gemini_api_key";
const API_MODEL = "osler_gemini_model";
const API_MAX_WAIT = "osler_gemini_max_wait";
const LIVE_MODEL_KEY = "osler_osce_live_model";

const SKIN_TONES = ["#FCE4D6", "#F3C9A0", "#E0AC82", "#C68658", "#9E5F32", "#6B3F1C"];
const HAIR_COLORS: Record<string, string> = { dark: "#2B2118", brown: "#5A3A22", blonde: "#D9B26A", grey: "#B8B8B8", white: "#ECECEC", red: "#A14A23" };
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const MAP_STEPS: [string, string][] = [
  ["Opening", "Intro & consent"],
  ["History", "Chief complaint"],
  ["Background", "PMH, meds, social"],
  ["ICE", "Concerns & expectations"],
  ["Closing", "Summarise & safety"],
];

/* ── Helpers ────────────────────────────────────────────────────────── */

function textOr(v: unknown, fallback: string): string {
  return v == null || v === "" ? fallback : String(v);
}

function pickField(obj: Record<string, unknown>, ...fields: string[]): unknown {
  for (const f of fields) {
    const v = obj[f];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function esc(s: string): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function md(text: string): string {
  if (!text) return "";
  let h = esc(text);
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\n/g, "<br>");
  return h;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sc = s % 60;
  return m + ":" + (sc < 10 ? "0" : "") + sc;
}

function timerState(s: number): "ok" | "warn" | "danger" {
  return s > 120 ? "ok" : s > 30 ? "warn" : "danger";
}

function diffClass(d: string): string {
  const l = d.toLowerCase();
  return l.includes("found") || l === "easy" ? "df-e" : l.includes("adv") || l === "hard" ? "df-h" : "df-m";
}

function userTurnCount(transcript: TranscriptEntry[]): number {
  let c = 0;
  for (const m of transcript) if (m.role === "user") c++;
  return c;
}

function sanitizeModelText(text: string): string {
  return text.replace(/This response is not intended to be medical advice[^.]*(?:consult|professional|treatment)[^.]*\./gi, "").trim();
}

function ageBand(age: number): string {
  if (age < 13) return "child";
  if (age < 20) return "teen";
  if (age < 60) return "adult";
  return "elder";
}

function isPediatric(age: number): boolean {
  return age < 16;
}

/* ── Mulberry32 PRNG ───────────────────────────────────────────────── */

function mulberry32(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

function weighted(rnd: () => number, weights: Record<string, number>): string {
  const keys = Object.keys(weights);
  let total = 0;
  for (const k of keys) total += weights[k];
  const r = rnd() * total;
  let acc = 0;
  for (const k of keys) {
    acc += weights[k];
    if (r <= acc) return k;
  }
  return keys[0];
}

interface AvatarParams {
  gender: string;
  age: number;
  ageBand: string;
  skin: string;
  hair: string;
  hairStyle: string;
  hairColorKey: string;
  headCovering: string;
  faceShape: string;
  accessory: string;
  expression: string;
  seed: string;
}

const HAIR_STYLES: Record<string, Record<string, string[]>> = {
  male: { child: ["short", "buzz", "curly-short"], teen: ["short", "buzz", "spiky"], adult: ["short", "side-part", "bald"], elder: ["short", "bald", "side-part"] },
  female: { child: ["long", "pigtails", "bob"], teen: ["long", "bob", "ponytail"], adult: ["long", "bob", "bun", "hijab"], elder: ["bob", "bun", "short"] },
};

const FACE_SHAPES = ["oval", "round", "square"];

function buildAvatarParams(gender: string, age: number, seed: string): AvatarParams {
  gender = gender.toLowerCase() === "female" ? "female" : "male";
  const band = ageBand(age);
  const rnd = mulberry32(String(seed || "x") + ":" + gender + ":" + age);
  let headCovering = "none";
  let hairStyle = pick(rnd, HAIR_STYLES[gender][band] || HAIR_STYLES[gender].adult);
  if (hairStyle === "hijab") { headCovering = "hijab"; hairStyle = "hidden"; }
  if (hairStyle === "bald") hairStyle = "bald";
  const hairColorKey = band === "child" ? pick(rnd, ["dark", "brown", "blonde", "red"]) : band === "elder" ? pick(rnd, ["grey", "white", "grey"]) : pick(rnd, ["dark", "brown", "blonde"]);
  const accWeights: Record<string, number> = { none: 0.6, glasses: 0.3, hearingAid: 0.1 };
  if (band === "elder") { accWeights.hearingAid = 0.25; accWeights.glasses = 0.4; accWeights.none = 0.35; }
  const expressions = band === "elder" ? ["tired", "concerned", "mild-pain", "neutral"] : ["neutral", "concerned", "tired", "mild-pain"];
  return {
    gender, age, ageBand: band, skin: pick(rnd, SKIN_TONES), hair: HAIR_COLORS[hairColorKey],
    hairStyle, hairColorKey, headCovering, faceShape: pick(rnd, FACE_SHAPES),
    accessory: weighted(rnd, accWeights), expression: pick(rnd, expressions), seed: String(seed || "x"),
  };
}

function renderAvatarSVG(p: AvatarParams): string {
  const accent = p.gender === "female" ? "#b35c8a" : "#2f7fb9";
  const muted = p.ageBand === "elder" ? "#d1d5db" : p.skin;
  const bandLabel = p.ageBand === "elder" ? "Older adult" : p.ageBand === "child" ? "Child" : p.ageBand === "teen" ? "Teenager" : "Adult";
  return `<svg viewBox="0 0 200 210" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Patient avatar">
    <rect x="18" y="18" width="164" height="174" rx="22" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.18)" stroke-width="2"/>
    <rect x="34" y="34" width="132" height="30" rx="15" fill="${accent}" opacity=".9"/>
    <circle cx="100" cy="104" r="38" fill="${muted}" opacity=".9"/>
    <path d="M54 170 Q60 135 100 135 Q140 135 146 170 Z" fill="${accent}" opacity=".75"/>
    <path d="M74 104 Q100 78 126 104" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="8" stroke-linecap="round"/>
    <circle cx="84" cy="108" r="4" fill="rgba(0,0,0,.45)"/><circle cx="116" cy="108" r="4" fill="rgba(0,0,0,.45)"/>
    <path d="M82 126 Q100 134 118 126" fill="none" stroke="rgba(0,0,0,.38)" stroke-width="4" stroke-linecap="round"/>
    <text x="100" y="55" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#fff">PATIENT</text>
    <text x="100" y="185" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="currentColor">${bandLabel}</text>
  </svg>`;
}

/* ── Normalization ─────────────────────────────────────────────────── */

function normalizeStation(raw: Record<string, unknown>, idx: number): OsceStation {
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
    task: textOr(pickField(raw, "task", "instructions"), type === "data-interp" ? "Interpret the data and answer the examiner's questions." : "Take a focused history from this patient."),
    time: Number(pickField(raw, "time")) || EXAM_TIME,
    examiner: (raw.examiner || { name: "Examiner", title: "Consultant" }) as OsceExaminer,
    dataPresented: (raw.dataPresented || null) as OsceStation["dataPresented"],
    questions: Array.isArray(raw.questions) ? raw.questions as OsceStation["questions"] : [],
    patient: {
      name: textOr(pickField(patient, "name", "displayName"), "Patient"),
      age: Number(pickField(patient, "age")) || 40,
      gender: (pickField(patient, "gender", "sex") || "male") === "female" ? "female" : "male",
      avatarSeed: textOr(pickField(patient, "avatarSeed", "avatar_seed"), "osce-" + idx),
      opening: textOr(pickField(patient, "opening", "greeting"), "Hello doctor, thank you for seeing me."),
    },
    hiddenProfile: {
      diagnosis: textOr(hidden.diagnosis, ""),
      keySymptoms: Array.isArray(hidden.keySymptoms || hidden.key_symptoms) ? (hidden.keySymptoms || hidden.key_symptoms) as string[] : [],
      redFlags: Array.isArray(hidden.redFlags || hidden.red_flags) ? (hidden.redFlags || hidden.red_flags) as string[] : [],
      pastHistory: Array.isArray(hidden.pastHistory || hidden.past_history) ? (hidden.pastHistory || hidden.past_history) as string[] : [],
      vitalSigns: textOr(hidden.vitalSigns || hidden.vital_signs, ""),
    },
    rubric: {
      mustAsk: Array.isArray(rubric.mustAsk || rubric.must_ask) ? (rubric.mustAsk || rubric.must_ask) as string[] : [],
      bonus: Array.isArray(rubric.bonus) ? rubric.bonus as string[] : [],
    },
  };
}

/* ── Prompt Builders ───────────────────────────────────────────────── */

function buildPatientSysPrompt(c: OsceStation): string {
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
  ].join("\n");
}

function buildExaminerSysPrompt(): string {
  return [
    "You are an expert OSCE examiner scoring a medical student's patient-interview transcript.",
    "Respond with a single raw JSON object and absolutely nothing else. No markdown, no fences.",
    'The JSON object must contain exactly these keys:',
    '  "score"      : integer 0-100 (overall, rounded to nearest 5)',
    '  "passed"     : boolean',
    '  "domains"    : { "communication": 0-25, "infoGathering": 0-25, "clinicalReasoning": 0-25, "professionalism": 0-25 }',
    '  "asked"      : array of strings',
    '  "missed"     : array of strings',
    '  "feedback"   : string — 2-3 sentences',
    "",
    "Each mustAsk item covered ≈ a large share of the score. Credit paraphrases.",
    "Domain scores should sum to approximately the overall score.",
  ].join("\n");
}

function buildExaminerUserPrompt(c: OsceStation, transcript: TranscriptEntry[]): string {
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
  lines.push(""); lines.push("Score this transcript. Return JSON only.");
  return lines.join("\n");
}

function buildDataInterpSysPrompt(c: OsceStation): string {
  const e = c.examiner || { name: "Examiner", title: "Consultant" };
  const dp = c.dataPresented || {};
  const lines: string[] = [
    "You are " + e.name + ", " + e.title + ", an expert medical examiner conducting an oral OSCE-style examination.",
    "",
    "1. Start by presenting yourself and the clinical case. Then present the data.",
    "2. Ask the student questions one at a time. Wait for their answer.",
    "3. Be warm, professional, and encouraging. Give positive reinforcement.",
    "4. If the student struggles, offer gentle hints. Never give the answer away immediately.",
    "5. NEVER break character, never mention being an AI.",
    "6. Do NOT summarise performance at the end. Evaluation happens after.",
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
  const questions = c.questions || [];
  if (questions.length) {
    lines.push("QUESTIONS (ask in order):");
    questions.forEach((q, qi) => {
      lines.push((qi + 1) + ". " + q.question);
      if (q.answer) lines.push("   Model answer: " + q.answer);
    });
  }
  lines.push(
    "Match the student's language (Arabic or English). Clinical terms stay in English.",
    "Keep a mental score out of 100. Do NOT share it.",
  );
  return lines.join("\n");
}

function buildDataInterpScoreSysPrompt(): string {
  return [
    "You are an expert medical examiner scoring a student's data-interpretation OSCE.",
    "Respond with a single raw JSON object. No markdown, no fences.",
    'The JSON must contain: "score" (0-100), "passed" (bool),',
    '"domains": { "knowledge": 0-30, "interpretation": 0-30, "reasoning": 0-25, "communication": 0-15 },',
    '"asked" (string[]), "missed" (string[]), "feedback" (string).',
    "Mixing Arabic and English is normal. Do NOT penalise code-switching.",
  ].join("\n");
}

function buildDataInterpScoreUserPrompt(c: OsceStation, transcript: TranscriptEntry[]): string {
  const lines = ["CASE: " + c.title, "SPECIALTY: " + c.specialty, ""];
  const dp = c.dataPresented || {};
  if (dp.scenario) lines.push("SCENARIO: " + dp.scenario);
  if (c.questions && c.questions.length) {
    lines.push("QUESTIONS:");
    c.questions.forEach((q, i) => lines.push((i + 1) + ". " + q.question + (q.answer ? " [" + q.answer + "]" : "")));
  }
  lines.push("", "TRANSCRIPT:");
  transcript.forEach((t) => lines.push((t.role === "user" ? "Student: " : "Examiner: ") + t.text));
  lines.push("", "Score this transcript. Return JSON only.");
  return lines.join("\n");
}

/* ── Scoring ───────────────────────────────────────────────────────── */

interface DomainScores {
  [key: string]: number;
}

interface ExamResult {
  score: number;
  passed: boolean;
  domains: DomainScores;
  asked: string[];
  missed: string[];
  feedback: string;
}

function scoreRubric(raw: string): ExamResult | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    const score = Math.max(0, Math.min(100, parseInt(obj.score, 10)));
    if (isNaN(score)) return null;
    const d = obj.domains || {};
    return {
      score, passed: !!obj.passed,
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
  } catch { return null; }
}

function scoreDataInterp(raw: string): ExamResult | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    const score = Math.max(0, Math.min(100, parseInt(obj.score, 10)));
    if (isNaN(score)) return null;
    const d = obj.domains || {};
    return {
      score, passed: !!obj.passed,
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
  } catch { return null; }
}

/* ── API Helpers ───────────────────────────────────────────────────── */

function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(API_KEY) || "";
}

function hasApiKey(): boolean {
  return !!getApiKey();
}

function getModel(): string {
  if (typeof window === "undefined") return MODELS[0][0];
  return localStorage.getItem(API_MODEL) || MODELS[0][0];
}

function getMaxWaitMs(): number {
  const v = parseInt(localStorage.getItem(API_MAX_WAIT) || "15", 10);
  return v > 0 ? v * 1000 : 0;
}

function getLiveModel(): string {
  return localStorage.getItem(LIVE_MODEL_KEY) || LIVE_MODELS[0][0];
}

async function callGemini(systemPrompt: string, contents: Array<{ role: string; parts: Array<{ text: string }> }>, signal?: AbortSignal): Promise<string> {
  const key = getApiKey();
  const model = getModel();
  if (!key) throw new Error("API key not configured");
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${key}`;
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
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

async function askPatient(c: OsceStation, transcript: TranscriptEntry[], signal?: AbortSignal): Promise<string> {
  const contents = transcript.map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text }] }));
  return callGemini(buildPatientSysPrompt(c), contents, signal);
}

async function askExaminer(c: OsceStation, transcript: TranscriptEntry[], signal?: AbortSignal): Promise<string> {
  const contents = transcript.map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text }] }));
  return callGemini(buildDataInterpSysPrompt(c), contents, signal);
}

async function scoreInterview(c: OsceStation, transcript: TranscriptEntry[], signal?: AbortSignal): Promise<ExamResult> {
  const contents = [{ role: "user", parts: [{ text: buildExaminerUserPrompt(c, transcript) }] }];
  const raw = await callGemini(buildExaminerSysPrompt(), contents, signal);
  const cleaned = String(raw).replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();
  const parsed = scoreRubric(cleaned);
  if (!parsed) throw new Error("Examiner returned malformed feedback. Try again.");
  return parsed;
}

async function scoreDataInterpExam(c: OsceStation, transcript: TranscriptEntry[], signal?: AbortSignal): Promise<ExamResult> {
  const contents = [{ role: "user", parts: [{ text: buildDataInterpScoreUserPrompt(c, transcript) }] }];
  const raw = await callGemini(buildDataInterpScoreSysPrompt(), contents, signal);
  const cleaned = String(raw).replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();
  const parsed = scoreDataInterp(cleaned);
  if (!parsed) throw new Error("Examiner returned malformed feedback. Try again.");
  return parsed;
}

/* ── Types ─────────────────────────────────────────────────────────── */

interface TranscriptEntry {
  role: "user" | "model";
  text: string;
}

type OscePhase = "select" | "lobby" | "conversation" | "debrief";

interface Achievement {
  icon: string;
  label: string;
  desc: string;
  color: "gold" | "green" | "blue" | "purple";
}

/* ── SpeechRecognition types (browser API) ────────────────────────── */

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

/* ── Component Props ───────────────────────────────────────────────── */

interface OsceStudioProps {
  activeItem: ManifestItem | null;
  activeContent: OsceContent | null;
  onExit: () => void;
  onOpenPack?: (item: ManifestItem) => void;
}

/* ── Radar Chart SVG Builder ───────────────────────────────────────── */

function buildRadarSVG(domains: DomainScores, isDataInterp: boolean): string {
  const cx = 80, cy = 80, maxR = 60;
  const domainKeys = isDataInterp
    ? [{ k: "knowledge", m: 30 }, { k: "interpretation", m: 30 }, { k: "reasoning", m: 25 }, { k: "communication", m: 15 }]
    : [{ k: "communication", m: 25 }, { k: "infoGathering", m: 25 }, { k: "clinicalReasoning", m: 25 }, { k: "professionalism", m: 25 }];
  const vals = domainKeys.map((dk) => (domains[dk.k] || 0) / dk.m);
  const colors = ["#38bdf8", "#f0a500", "#8b5cf6", "#2ea043"];
  const angles = [-90, 0, 90, 180];

  const pt = (angle: number, r: number) => {
    const rad = angle * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const gridHTML = [0.25, 0.5, 0.75, 1].map((f) => {
    const r = f * maxR;
    const pts = angles.map((a) => pt(a, r));
    const d = pts.map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ") + "Z";
    return `<path d="${d}" fill="none" stroke="var(--border)" stroke-width="1" opacity="0.7"/>`;
  }).join("");

  const axisHTML = angles.map((a) => {
    const p = pt(a, maxR);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="var(--border)" stroke-width="1" opacity="0.5"/>`;
  }).join("");

  const scorePts = vals.map((v, i) => pt(angles[i], v * maxR));
  const scoreD = scorePts.map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ") + "Z";
  const scoreHTML = `<path d="${scoreD}" fill="rgba(240,165,0,.18)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
  const dotsHTML = scorePts.map((p, i) =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${colors[i]}" stroke="var(--surface)" stroke-width="1.5"/>`
  ).join("");

  return gridHTML + axisHTML + scoreHTML + dotsHTML;
}

/* ── Achievements Builder ──────────────────────────────────────────── */

function buildAchievements(result: ExamResult, timeUsedPct: number, turnCount: number): Achievement[] {
  const b: Achievement[] = [];
  if (result.score >= 80) b.push({ icon: "🌟", label: "Outstanding", desc: "Score ≥ 80", color: "gold" });
  else if (result.score >= 50) b.push({ icon: "✅", label: "Passed", desc: "Station passed", color: "green" });
  if (result.missed.length === 0 && result.asked.length > 0) b.push({ icon: "🎯", label: "Full Coverage", desc: "All criteria covered", color: "green" });
  if ((result.domains.communication || 0) >= 22) b.push({ icon: "💬", label: "Communicator", desc: "Communication ≥ 22/25", color: "blue" });
  if ((result.domains.professionalism || 0) >= 22) b.push({ icon: "🎖", label: "Professional", desc: "Professionalism ≥ 22/25", color: "blue" });
  if ((result.domains.clinicalReasoning || 0) >= 22) b.push({ icon: "🧠", label: "Clinician", desc: "Clinical reasoning ≥ 22/25", color: "purple" });
  if ((result.domains.infoGathering || 0) >= 22) b.push({ icon: "🔍", label: "Thorough", desc: "Info gathering ≥ 22/25", color: "purple" });
  if (timeUsedPct < 65 && result.score >= 50) b.push({ icon: "⚡", label: "Efficient", desc: "Completed quickly", color: "gold" });
  if (turnCount >= 15 && result.score >= 50) b.push({ icon: "💪", label: "Persistent", desc: "15+ questions asked", color: "blue" });
  return b;
}

/* ── Confetti ──────────────────────────────────────────────────────── */

function launchConfetti() {
  if (typeof window === "undefined") return;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999;width:100%;height:100%";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const colors = ["#f0a500", "#38bdf8", "#2ea043", "#8b5cf6", "#da3633", "#fff"];
  const particles = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width, y: Math.random() * -canvas.height * 0.5,
    w: 6 + Math.random() * 8, h: 3 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 5,
    rot: Math.random() * 360, vrot: (Math.random() - 0.5) * 8, alpha: 1,
  }));
  let start: number | null = null;
  function frame(ts: number) {
    if (!start) start = ts;
    const elapsed = ts - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.y += p.vy; p.x += p.vx; p.rot += p.vrot;
      if (elapsed > 2200) p.alpha = Math.max(0, p.alpha - 0.03);
      ctx.save(); ctx.globalAlpha = p.alpha; ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
    if (elapsed < 3500) requestAnimationFrame(frame);
    else { if (canvas.parentNode) canvas.parentNode.removeChild(canvas); }
  }
  requestAnimationFrame(frame);
}

/* ── Speaker Info ──────────────────────────────────────────────────── */

function getSpeakerName(c: OsceStation): string {
  if (c.type === "data-interp") return c.examiner?.name || "Examiner";
  return c.patient?.name || "Patient";
}

function getSpeakerGender(c: OsceStation): string {
  if (c.type === "data-interp") return "male";
  if (isPediatric(c.patient.age)) return "female";
  return c.patient.gender;
}

/* ── OS CE Studio Component ───────────────────────────────────────── */

export function OsceStudio({ activeItem, activeContent, onExit, onOpenPack }: OsceStudioProps) {
  const isMobile = useIsMobile();

  /* State */
  const [availablePacks, setAvailablePacks] = React.useState<Array<{ item: ManifestItem; content: OsceContent }>>([]);
  const [selectedPack, setSelectedPack] = React.useState<{ item: ManifestItem; content: OsceContent } | null>(null);
  const [stations, setStations] = React.useState<OsceStation[]>([]);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [phase, setPhase] = React.useState<OscePhase>("select");
  const [transcript, setTranscript] = React.useState<TranscriptEntry[]>([]);
  const [timerRemaining, setTimerRemaining] = React.useState(EXAM_TIME);
  const [timerStarted, setTimerStarted] = React.useState(false);
  const [inputText, setInputText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [thinking, setThinking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ExamResult | null>(null);
  const [voiceOn, setVoiceOn] = React.useState(false);
  const [voicePhase, setVoicePhase] = React.useState<"idle" | "listening" | "speaking">("idle");
  const [interimText, setInterimText] = React.useState("");
  const [resetModalOpen, setResetModalOpen] = React.useState(false);
  const [renderedCount, setRenderedCount] = React.useState(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const transcriptRef = React.useRef<TranscriptEntry[]>([]);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = React.useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Sync transcript ref */
  React.useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  /* Load content */
  React.useEffect(() => {
    if (activeContent && activeContent.type === "osce") {
      const normalized = activeContent.stations.map((s, i) =>
        normalizeStation(s as unknown as Record<string, unknown>, i)
      );
      setStations(normalized);
    } else {
      loadDemoContent();
    }
  }, [activeContent]);

  async function loadDemoContent() {
    try {
      const { items } = await loadAllContent();
      const osce = items.find((x) => x.content?.type === "osce");
      if (osce && osce.content) {
        const normalized = (osce.content as OsceContent).stations.map((s, i) =>
          normalizeStation(s as unknown as Record<string, unknown>, i)
        );
        setStations(normalized);
      }
    } catch { /* no osce content available */ }
  }

  const activeCase = stations[activeIdx] || null;

  /* ── Gemini Live Voice System ────────────────────────────── */

  const liveSessionRef = React.useRef<WebSocket | null>(null);
  const liveAudioCtxRef = React.useRef<AudioContext | null>(null);
  const liveMicStreamRef = React.useRef<MediaStream | null>(null);
  const liveMicProcessorRef = React.useRef<AudioNode | null>(null);
  const livePlayCtxRef = React.useRef<AudioContext | null>(null);
  const livePlayScheduleTimeRef = React.useRef(0);
  const liveInterimTextRef = React.useRef("");
  const liveModelAccumTextRef = React.useRef("");

  function getGenderVoice(): string {
    if (!activeCase) return "Charon";
    if (activeCase.type === "data-interp") return "Charon";
    if (isPediatric(activeCase.patient.age)) return "Aoede";
    return activeCase.patient.gender === "female" ? "Aoede" : "Charon";
  }

  function startGeminiLive() {
    stopGeminiLive();
    if (!hasApiKey()) { setError("API key required for Gemini Live mode."); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setError("Microphone not accessible."); return; }

    setVoicePhase("listening");

    const modelName = getLiveModel();
    const apiKey = getApiKey();
    const wsUrl = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" + apiKey;

    const ws = new WebSocket(wsUrl);
    liveSessionRef.current = ws;

    ws.onopen = () => {
      const sysPrompt = activeCase && activeCase.type === "data-interp"
        ? buildDataInterpSysPrompt(activeCase)
        : buildPatientSysPrompt(activeCase);

      ws.send(JSON.stringify({
        setup: {
          model: "models/" + modelName,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: getGenderVoice() } } },
            temperature: 1.0,
          },
          systemInstruction: { parts: [{ text: sysPrompt }] },
        },
      }));
    };

    ws.onmessage = (e: MessageEvent) => {
      const raw = e.data;
      if (raw instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => handleLiveMessage(reader.result as string);
        reader.readAsText(raw);
        return;
      }
      if (raw instanceof ArrayBuffer) {
        handleLiveMessage(new TextDecoder().decode(raw));
        return;
      }
      handleLiveMessage(raw);
    };

    function handleLiveMessage(jsonStr: string) {
      try {
        const data = JSON.parse(jsonStr);

        if (data.setupComplete) {
          if (transcriptRef.current.length) {
            const firstUserIdx = transcriptRef.current.findIndex((m) => m.role !== "model");
            if (firstUserIdx >= 0) {
              const histTurns = transcriptRef.current.slice(firstUserIdx).map((m) => ({
                role: m.role === "model" ? "model" : "user",
                parts: [{ text: m.text }],
              }));
              ws.send(JSON.stringify({ clientContent: { turns: histTurns, turnComplete: false } }));
            }
          }
          setTimeout(startLiveMic, 300);
          return;
        }

        if (data.error) { console.error("[GeminiLive] Error:", data.error); return; }

        const sc = data.serverContent;
        if (!sc) return;

        // Input transcription (user speech)
        if (sc.inputTranscription && sc.inputTranscription.text) {
          const userText = sc.inputTranscription.text.trim();
          setVoicePhase("listening");
          if (!userText) {
            liveInterimTextRef.current = "";
            setInterimText("");
          } else if (sc.inputTranscription.finished) {
            const transcriptNow = transcriptRef.current;
            const last = transcriptNow.length && transcriptNow[transcriptNow.length - 1];
            if (!(last && last.role === "user" && last.text === userText)) {
              const updated = [...transcriptNow, { role: "user" as const, text: userText }];
              setTranscript(updated);
              setRenderedCount((prev) => prev + 1);
              saveSession();
            }
            liveInterimTextRef.current = "";
            setInterimText("");
          } else {
            liveInterimTextRef.current = userText;
            setInterimText(userText);
          }
        }

        // Output transcription (model speech)
        if (sc.outputTranscription && sc.outputTranscription.text) {
          const modelText = sc.outputTranscription.text.trim();
          if (modelText && sc.outputTranscription.finished) {
            finalizeModelText(modelText);
          } else if (modelText) {
            setVoicePhase("speaking");
            if (modelText.length > liveModelAccumTextRef.current.length && modelText.startsWith(liveModelAccumTextRef.current)) {
              liveModelAccumTextRef.current = modelText;
            } else {
              liveModelAccumTextRef.current += (liveModelAccumTextRef.current ? " " : "") + modelText;
            }
          }
        }

        // modelTurn with audio
        if (sc.modelTurn && sc.modelTurn.parts && sc.modelTurn.parts.length) {
          setVoicePhase("speaking");
          if (liveInterimTextRef.current) {
            const transcriptNow = transcriptRef.current;
            const last = transcriptNow.length && transcriptNow[transcriptNow.length - 1];
            if (!(last && last.role === "user" && last.text === liveInterimTextRef.current)) {
              setTranscript([...transcriptNow, { role: "user", text: liveInterimTextRef.current }]);
              setRenderedCount((prev) => prev + 1);
            }
            liveInterimTextRef.current = "";
            setInterimText("");
          }
          sc.modelTurn.parts.forEach((part: { inlineData?: { mimeType: string; data: string } }) => {
            if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.includes("audio")) {
              playLiveAudio(part.inlineData.data, part.inlineData.mimeType);
            }
          });
        }

        // Interruption
        if (sc.interrupted) {
          if (livePlayCtxRef.current) { try { livePlayCtxRef.current.close(); } catch { } livePlayCtxRef.current = null; }
          livePlayScheduleTimeRef.current = 0;
          liveModelAccumTextRef.current = "";
          setVoicePhase("listening");
        }

        // Turn complete
        if (sc.turnComplete) {
          if (liveModelAccumTextRef.current) {
            finalizeModelText(liveModelAccumTextRef.current);
          }
          setVoicePhase("idle");
        }
      } catch (e) {
        console.error("[GeminiLive] parse error:", e);
      }
    }

    function finalizeModelText(text: string) {
      if (!text) return;
      const transcriptNow = transcriptRef.current;
      const last = transcriptNow.length && transcriptNow[transcriptNow.length - 1];
      if (last && last.role === "model" && last.text === text) return;
      const updated = [...transcriptNow, { role: "model" as const, text: sanitizeModelText(text) }];
      setTranscript(updated);
      setRenderedCount((prev) => prev + 1);
      liveModelAccumTextRef.current = "";
      saveSession();
    }

    ws.onerror = () => {
      stopGeminiLive();
      setError("Gemini Live connection failed. Falling back to text mode.");
    };

    ws.onclose = () => {
      liveSessionRef.current = null;
      stopLiveMic();
      setVoicePhase("idle");
    };
  }

  function stopGeminiLive() {
    stopLiveMic();
    livePlayScheduleTimeRef.current = 0;
    liveInterimTextRef.current = "";
    liveModelAccumTextRef.current = "";
    if (liveSessionRef.current) { try { liveSessionRef.current.close(); } catch { } liveSessionRef.current = null; }
    if (livePlayCtxRef.current) { try { livePlayCtxRef.current.close(); } catch { } livePlayCtxRef.current = null; }
    if (liveAudioCtxRef.current) { try { liveAudioCtxRef.current.close(); } catch { } liveAudioCtxRef.current = null; }
    setInterimText("");
    setVoicePhase("idle");
  }

  function startLiveMic() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      liveMicStreamRef.current = stream;
      const actx = new (window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext)({ sampleRate: 16000 }) as AudioContext;
      liveAudioCtxRef.current = actx;
      const source = actx.createMediaStreamSource(stream);

      const processorCode = "class MicProcessor extends AudioWorkletProcessor{process(inputs){this.port.postMessage(inputs[0][0]);return true;}}registerProcessor('mic-processor',MicProcessor);";
      const blob = new Blob([processorCode], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);

      actx.audioWorklet.addModule(url).then(() => {
        const node = new AudioWorkletNode(actx, "mic-processor");
        node.port.onmessage = (e) => {
          if (!liveSessionRef.current || liveSessionRef.current.readyState !== WebSocket.OPEN) return;
          const input = e.data as Float32Array;
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
          const bytes = new Uint8Array(pcm.buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const b64 = btoa(binary);
          liveSessionRef.current.send(JSON.stringify({ realtimeInput: { audio: { data: b64, mimeType: "audio/pcm" } } }));
        };
        source.connect(node);
        liveMicProcessorRef.current = node;
        URL.revokeObjectURL(url);
      }).catch(() => {
        startLiveMicFallback(stream);
      });
    }).catch((err) => {
      stopGeminiLive();
      setError("Microphone access denied: " + err.message);
    });
  }

  function startLiveMicFallback(stream: MediaStream) {
    try {
      const actx = liveAudioCtxRef.current;
      if (!actx) return;
      const processor = actx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (!liveSessionRef.current || liveSessionRef.current.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
        const bytes = new Uint8Array(pcm.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        liveSessionRef.current.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(binary), mimeType: "audio/pcm" } } }));
      };
      const source = actx.createMediaStreamSource(stream);
      source.connect(processor);
      liveMicProcessorRef.current = processor;
    } catch (e) {
      stopGeminiLive();
      setError("Microphone init failed.");
    }
  }

  function stopLiveMic() {
    if (liveMicProcessorRef.current) {
      try { (liveMicProcessorRef.current as AudioNode).disconnect(); } catch { }
      liveMicProcessorRef.current = null;
    }
    if (liveMicStreamRef.current) {
      liveMicStreamRef.current.getTracks().forEach((t) => t.stop());
      liveMicStreamRef.current = null;
    }
  }

  function playLiveAudio(b64data: string, mimeType: string) {
    try {
      let sampleRate = 24000;
      const match = mimeType && mimeType.match(/rate=(\d+)/);
      if (match) sampleRate = parseInt(match[1], 10);

      if (!livePlayCtxRef.current) {
        livePlayCtxRef.current = new (window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext)({ sampleRate }) as AudioContext;
        livePlayScheduleTimeRef.current = 0;
      }
      if (livePlayCtxRef.current.state === "suspended") { livePlayCtxRef.current.resume(); }

      const raw = atob(b64data);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let j = 0; j < int16.length; j++) float32[j] = int16[j] / 32768;

      const ctx = livePlayCtxRef.current;
      const buf = ctx.createBuffer(1, float32.length, sampleRate);
      buf.getChannelData(0).set(float32);

      const when = livePlayScheduleTimeRef.current > ctx.currentTime ? livePlayScheduleTimeRef.current : ctx.currentTime + 0.01;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(when);
      livePlayScheduleTimeRef.current = when + buf.duration;
      setVoicePhase("speaking");
    } catch (e) {
      console.error("[GeminiLive] playLiveAudio error:", e);
    }
  }

  function sendLiveText(text: string) {
    if (liveSessionRef.current && liveSessionRef.current.readyState === WebSocket.OPEN) {
      liveSessionRef.current.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } }));
    }
  }

  function toggleVoice() {
    if (!hasApiKey()) { setError("Set a Gemini API key in Settings first."); return; }
    const next = !voiceOn;
    setVoiceOn(next);
    localStorage.setItem(STORAGE.voiceOn, String(next));
    if (!next) {
      stopGeminiLive();
      setVoicePhase("idle");
    } else {
      stopGeminiLive(); // clean any stale session
      startGeminiLive();
    }
  }

  function stopSpeaking() {
    if (livePlayCtxRef.current) { try { livePlayCtxRef.current.close(); } catch { } livePlayCtxRef.current = null; }
    livePlayScheduleTimeRef.current = 0;
    setVoicePhase("idle");
  }

  /* TTS fallback for text-mode responses when voice is on */
  const voiceOnRef = React.useRef(false);
  React.useEffect(() => { voiceOnRef.current = voiceOn; }, [voiceOn]);

  function speakText(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setVoicePhase("speaking");
    const utt = new SpeechSynthesisUtterance(text);
    const savedVoice = localStorage.getItem(STORAGE.ttsVoice);
    const voices = window.speechSynthesis.getVoices();
    if (savedVoice) {
      const v = voices.find((v) => v.name === savedVoice);
      if (v) utt.voice = v;
    } else {
      const preferred = voices.find((v) => /en.gb/i.test(v.lang) || /daniel|samantha|karen|moira/i.test(v.name));
      if (preferred) utt.voice = preferred;
    }
    utt.rate = parseFloat(localStorage.getItem(STORAGE.ttsRate) || "0.95");
    utt.pitch = 1;
    utt.onend = () => { setVoicePhase(voiceOnRef.current ? "listening" : "idle"); };
    utt.onerror = () => { setVoicePhase(voiceOnRef.current ? "listening" : "idle"); };
    window.speechSynthesis.speak(utt);
  }

  /* Init voice on conversation entry */
  React.useEffect(() => {
    const on = localStorage.getItem(STORAGE.voiceOn) === "true";
    setVoiceOn(on);
    if (on && phase === "conversation") {
      setTimeout(startGeminiLive, 500);
    }
    return () => { stopGeminiLive(); };
  }, [phase === "conversation"]);

  /* Timer */
  React.useEffect(() => {
    if (phase !== "conversation" || !timerStarted) return;
    timerRef.current = setInterval(() => {
      setTimerRemaining((prev) => {
        const next = Math.max(0, prev - 1);
        if (next <= 0) { clearInterval(timerRef.current!); }
        return next;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, timerStarted]);

  function startTimer() {
    if (!timerStarted) setTimerStarted(true);
  }

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  /* Session save/load */
  function sessionKey(): string {
    return STORAGE.session + (activeItem?.uid || "osce");
  }

  function saveSession() {
    if (!activeCase || !transcript.length) return;
    try {
      localStorage.setItem(sessionKey(), JSON.stringify({ transcript, timerRemaining, timerStarted }));
    } catch { /* ignore */ }
  }

  function loadSession(): { transcript: TranscriptEntry[]; timerRemaining: number; timerStarted: boolean } | null {
    try {
      const r = localStorage.getItem(sessionKey());
      return r ? JSON.parse(r) : null;
    } catch { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem(sessionKey()); } catch { /* ignore */ }
  }

  /* Scroll to bottom */
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript, thinking]);

  /* Keyboard: Enter to send */
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase === "conversation") {
        if (settingsOpen) { setSettingsOpen(false); return; }
        if (resetModalOpen) { setResetModalOpen(false); return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, settingsOpen, resetModalOpen]);

  /* ── Phase: Lobby ──────────────────────────────────────────── */

  function startConsultation() {
    const saved = loadSession();
    if (saved && saved.transcript && saved.transcript.length) {
      setTranscript(saved.transcript);
      setTimerRemaining(saved.timerRemaining || activeCase?.time || EXAM_TIME);
      setTimerStarted(false);
      setPhase("conversation");
      setRenderedCount(0);
    } else {
      setTranscript([]);
      setRenderedCount(0);
      setTimerRemaining(activeCase?.time || EXAM_TIME);
      setTimerStarted(false);
      setPhase("conversation");
    }
  }

  /* ── Send Message ───────────────────────────────────────────── */

  async function handleSend() {
    const text = inputText.trim();
    if (!text || !activeCase) return;
    if (!hasApiKey()) { setError("Configure your Gemini API key in Settings first"); setSettingsOpen(true); return; }

    const turns = userTurnCount(transcript);
    if (turns >= MAX_TURNS) { setError("Maximum " + MAX_TURNS + " questions reached. Click Submit for feedback."); return; }

    setInputText("");
    setSending(true);
    setError(null);

    const newTranscript = [...transcript, { role: "user" as const, text }];
    setTranscript(newTranscript);
    setRenderedCount((prev) => prev + 1);
    setThinking(true);

    const aiFn = activeCase.type === "data-interp" ? askExaminer : askPatient;
    abortRef.current = new AbortController();

    try {
      const reply = await aiFn(activeCase, newTranscript, abortRef.current.signal);
      setThinking(false);
      const cleanReply = sanitizeModelText(reply);
      const updated = [...newTranscript, { role: "model" as const, text: cleanReply }];
      setTranscript(updated);
      setRenderedCount((prev) => prev + 2);
      saveSession();
      if (voiceOn) speakText(cleanReply);
      startTimer();
    } catch (err: unknown) {
      setThinking(false);
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to get response");
    } finally {
      setSending(false);
      if (inputRef.current) inputRef.current.focus();
    }
  }

  /* ── Submit for Feedback ────────────────────────────────────── */

  async function handleSubmit() {
    if (!hasApiKey()) { setError("Configure your Gemini API key first"); setSettingsOpen(true); return; }
    if (!transcript.filter((m) => m.role === "user").length) { setError("Ask at least one question first."); return; }
    if (!activeCase) return;

    stopTimer();
    if (abortRef.current) { abortRef.current.abort(); }
    setThinking(true);
    setError(null);

    abortRef.current = new AbortController();
    const scoreFn = activeCase.type === "data-interp" ? scoreDataInterpExam : scoreInterview;

    try {
      const r = await scoreFn(activeCase, transcript, abortRef.current.signal);
      clearSession();
      setResult(r);
      setPhase("debrief");
      if (r.score >= 80) setTimeout(launchConfetti, 400);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Feedback failed");
    } finally {
      setThinking(false);
    }
  }

  /* ── Reset ──────────────────────────────────────────────────── */

  function handleReset() {
    stopTimer();
    if (voiceOn) { stopSpeaking(); }
    setTranscript([]);
    setRenderedCount(0);
    setTimerRemaining(activeCase?.time || EXAM_TIME);
    setTimerStarted(false);
    setResult(null);
    setError(null);
    clearSession();
    setPhase("lobby");
    setResetModalOpen(false);
  }

  /* ── Voice (TTS) ────────────────────────────────────────────── */

  /* ── Quick Prompts ──────────────────────────────────────────── */

  function insertPrompt(text: string) {
    setInputText(text);
    if (inputRef.current) { inputRef.current.focus(); }
  }

  /* ── Derived Values ─────────────────────────────────────────── */

  const turnCount = userTurnCount(transcript);
  const stationDuration = activeCase?.time || EXAM_TIME;
  const timeUsedPct = Math.round(((stationDuration - timerRemaining) / stationDuration) * 100);
  const turnPct = Math.min(100, Math.round((turnCount / Math.max(1, WARN_TURNS)) * 100));
  const momentum = Math.min(100, Math.round(turnPct * 0.7 + Math.min(timeUsedPct, 90) * 0.3));
  const isDataInterp = activeCase?.type === "data-interp";

  const mapStep = (function () {
    if (turnCount < 2) return 0;
    if (turnCount < 7) return 1;
    if (turnCount < 12) return 2;
    if (turnCount < 17) return 3;
    return 4;
  })();

  function getSpeaker() {
    if (!activeCase) return { name: "Patient", gender: "female" };
    return { name: getSpeakerName(activeCase), gender: getSpeakerGender(activeCase) };
  }

  /* Inject waveform keyframes once */
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("osce-wavestyles")) return;
    const st = document.createElement("style");
    st.id = "osce-wavestyles";
    st.textContent = "@keyframes w1{0%,100%{height:4px}50%{height:18px}}@keyframes w2{0%,100%{height:9px}50%{height:26px}}@keyframes w3{0%,100%{height:6px}50%{height:22px}}";
    document.head.appendChild(st);
  }, []);

  /* ── Render ─────────────────────────────────────────────────── */

  if (!activeCase) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center max-w-md p-8">
          <Stethoscope className="size-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">No OSCE Content Available</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Load an OSCE content pack from the Library or Dashboard to get started.
          </p>
          <button onClick={onExit} className="h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const p = activeCase.patient;
  const speaker = getSpeaker();

  /* ── Lobby Screen ──────────────────────────────────────────── */

  if (phase === "lobby") {
    const avParams = buildAvatarParams(p.gender, p.age, p.avatarSeed);
    const avSVG = renderAvatarSVG(avParams);
    const dur = Math.floor(stationDuration / 60);
    const domainCount = isDataInterp ? 4 : 4;

    return (
      <div className="h-full bg-background overflow-y-auto">
        <div className="min-h-full flex items-center justify-center p-5">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-2xl bg-card border border-border/60 rounded-2xl shadow-lg"
          >
            {/* Top bar */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
              <div className="flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-primary">
                <Stethoscope className="size-3.5" />
                {isDataInterp ? "OSCE Data Interpretation" : "OSCE Virtual Patient"}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onExit}
                  className="size-8 rounded-lg border border-border/60 bg-muted/40 hover:bg-muted/60 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  title="Back"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="size-8 rounded-lg border border-border/60 bg-muted/40 hover:bg-muted/60 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  title="Settings"
                >
                  <SettingsIcon className="size-3.5" />
                </button>
                <button
                  onClick={toggleTheme}
                  className="size-8 rounded-lg border border-border/60 bg-muted/40 hover:bg-muted/60 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  title="Toggle theme"
                >
                  {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                </button>
              </div>
            </div>

            {/* Hero */}
            {isDataInterp ? (
              <div className="px-5 pt-5 pb-2">
                <h2 className="text-xl font-bold font-serif mb-1">{activeCase.examiner?.name || "Examiner"}</h2>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border border-border/60 bg-muted/40 text-muted-foreground">{activeCase.specialty}</span>
                  <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-muted/40", diffClass(activeCase.difficulty))}>{activeCase.difficulty}</span>
                </div>
                <p className="text-sm text-muted-foreground">{activeCase.title}</p>
              </div>
            ) : (
              <div className="grid grid-cols-[auto_1fr] gap-6 items-center px-5 pt-5 pb-2">
                <div className="size-28 rounded-xl overflow-hidden border-2 border-border/60 bg-muted/30 shadow-[0_0_0_6px_rgba(56,189,248,.12)]"
                  dangerouslySetInnerHTML={{ __html: avSVG }} />
                <div>
                  <h2 className="text-xl font-bold font-serif mb-1.5">{p.name}</h2>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border border-border/60 bg-muted/40 text-muted-foreground">{p.age} yrs</span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border border-border/60 bg-muted/40 text-muted-foreground">{p.gender}</span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border border-border/60 bg-muted/40 text-muted-foreground">{activeCase.specialty}</span>
                    <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-muted/40", diffClass(activeCase.difficulty))}>{activeCase.difficulty}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{activeCase.title}</p>
                </div>
              </div>
            )}

            {/* Body */}
            <div className="px-5 pb-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Your Task</div>
              <div className="bg-muted/30 border border-border/60 rounded-lg p-3 text-sm leading-relaxed mb-3">{activeCase.task}</div>
              {isDataInterp && activeCase.dataPresented?.scenario && (
                <>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Clinical Scenario</div>
                  <div className="bg-muted/30 border border-border/60 rounded-lg p-3 text-sm leading-relaxed mb-3">{activeCase.dataPresented.scenario}</div>
                </>
              )}
              {isDataInterp && activeCase.dataPresented?.tables && activeCase.dataPresented.tables.length > 0 && (
                <DataTablesRenderer tables={activeCase.dataPresented.tables} />
              )}
              {isDataInterp && activeCase.dataPresented?.images && activeCase.dataPresented.images.length > 0 && (
                <DataImagesRenderer images={activeCase.dataPresented.images} />
              )}

              {/* Stats */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                {[
                  { val: dur + "m", label: "Time" },
                  { val: String(MAX_TURNS), label: "Questions" },
                  { val: String(domainCount), label: "Domains" },
                  { val: "AI", label: "Examiner" },
                ].map((s) => (
                  <div key={s.label} className="bg-muted/30 border border-border/60 rounded-lg p-2 text-center">
                    <div className="text-base font-bold leading-tight tabular-nums">{s.val}</div>
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Flow */}
              <div className="grid grid-cols-5 gap-1.5 mb-4">
                {(isDataInterp
                  ? [["1", "Data", "Review"], ["2", "Questions", "Oral exam"], ["3", "Feedback", "Scoring"]]
                  : [["1", "Open", "Intro"], ["2", "History", "Complaint"], ["3", "Background", "PMH"], ["4", "ICE", "Concerns"], ["5", "Close", "Summarise"]]
                ).map(([n, t, s]) => (
                  <div key={n} className="bg-muted/30 border border-border/60 rounded-lg p-1.5 text-center">
                    <div className="text-[10px] font-bold text-primary mb-0.5">{n}</div>
                    <div className="text-[11px] font-bold truncate">{t}</div>
                    <div className="text-[9px] text-muted-foreground truncate">{s}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="px-5 py-3 border-t border-border/60 flex gap-3 flex-wrap">
              <button
                onClick={startConsultation}
                className="h-11 px-6 rounded-lg bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition-all active:scale-[.97]"
              >
                {isDataInterp ? "Begin Exam \u2192" : "Enter Room \u2192"}
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="h-11 px-5 rounded-lg border border-border/60 bg-muted/40 text-foreground font-semibold text-sm hover:border-primary/60 transition-colors"
              >
                AI Settings
              </button>
            </div>
          </motion.div>
        </div>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </div>
    );
  }

  /* ── Conversation Phase ─────────────────────────────────────── */

  if (phase === "conversation") {
    const avParams = buildAvatarParams(p.gender, p.age, p.avatarSeed);
    const avSVG = renderAvatarSVG(avParams);
    const isTimeUp = timerRemaining <= 0;

    return (
      <div className="h-full bg-background flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center gap-2 px-3 py-2 bg-card border-b border-border/60 shrink-0">
          <button
            onClick={() => { stopTimer(); setPhase("lobby"); }}
            className="size-8 rounded-lg hover:bg-muted/60 flex items-center justify-center shrink-0"
            title="Back to lobby"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold truncate">
              {isDataInterp ? activeCase.examiner?.name || "Examiner" : activeCase.title}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{activeCase.task}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div className="flex flex-col items-center gap-px px-2 border-l border-border/60 ml-0.5 shrink-0">
              <div className={cn("text-base font-bold tabular-nums leading-tight", timerState(timerRemaining) === "ok" && "text-green-500", timerState(timerRemaining) === "warn" && "text-amber-500", timerState(timerRemaining) === "danger" && "text-red-500 animate-pulse")}>
                {formatTime(timerRemaining)}
              </div>
              <div className="text-[8px] uppercase tracking-wider text-muted-foreground">{Math.floor(stationDuration / 60)} min</div>
            </div>
            <button onClick={toggleTheme} className="size-8 rounded-lg hover:bg-muted/60 flex items-center justify-center" title="Toggle theme">
              {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
            <button onClick={() => setSettingsOpen(true)} className="size-8 rounded-lg hover:bg-muted/60 flex items-center justify-center" title="Settings">
              <SettingsIcon className="size-3.5" />
            </button>
          </div>
        </header>

        {/* Timer bar */}
        <div className="h-[3px] bg-muted/40 shrink-0 overflow-hidden">
          <div
            className={cn("h-full transition-all duration-1000 linear", timerState(timerRemaining) === "ok" && "bg-green-500", timerState(timerRemaining) === "warn" && "bg-amber-500", timerState(timerRemaining) === "danger" && "bg-red-500")}
            style={{ width: (timerRemaining / stationDuration) * 100 + "%" }}
          />
        </div>

        {/* Time up banner */}
        <AnimatePresence>
          {isTimeUp && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-gradient-to-r from-red-900/80 to-red-800/80 text-red-200 font-bold text-xs text-center py-1.5 shrink-0"
            >
              Time expired &mdash; submit for examiner feedback
            </motion.div>
          )}
        </AnimatePresence>

        {/* Body */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Sidebar (desktop) */}
          {!isMobile && (
            <aside
              className="bg-muted/20 border-r border-border/60 flex flex-col gap-3 p-3 overflow-y-auto shrink-0"
              style={{ width: sidebarWidth }}
            >
              {isDataInterp ? (
                /* Data-Interp Sidebar */
                <div className="bg-card border border-border/60 rounded-lg p-3">
                  <div className="font-bold text-sm">{activeCase.examiner?.name || "Examiner"}</div>
                  <div className="text-xs text-muted-foreground">{activeCase.examiner?.title || "Consultant"}</div>
                </div>
              ) : (
                /* History Sidebar */
                <div className="bg-card border border-border/60 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <div className="size-12 rounded-lg overflow-hidden border border-border/60 bg-muted/30" dangerouslySetInnerHTML={{ __html: avSVG }} />
                    <div>
                      <div className="font-bold text-sm">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground">{p.age} yrs &bull; {p.gender}<br />{activeCase.specialty} &bull; {activeCase.difficulty}</div>
                    </div>
                  </div>
                </div>
              )}
              {!isDataInterp && (
                <div className="bg-card border border-border/60 rounded-lg p-3">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Instructions</div>
                  <div className="text-xs leading-relaxed">{activeCase.task}</div>
                </div>
              )}
              <div className="bg-card border border-border/60 rounded-lg p-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Station Run</div>
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1"><span>Questions</span><strong className="text-foreground tabular-nums">{turnCount} / {MAX_TURNS}</strong></div>
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1"><span>Time used</span><strong className="text-foreground tabular-nums">{timeUsedPct}%</strong></div>
                <div className="h-1.5 bg-border/40 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-primary transition-all duration-500" style={{ width: momentum + "%" }} />
                </div>
              </div>
              {!isDataInterp && (
                <>
                  <div className="bg-card border border-border/60 rounded-lg p-3">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Consultation Map</div>
                    <div className="flex flex-col gap-0.5">
                      {MAP_STEPS.map(([label, desc], i) => (
                        <div key={i} className={cn(
                          "flex items-center gap-1.5 text-[11px] px-1 py-0.5 rounded transition-all",
                          i < mapStep && "text-green-500",
                          i === mapStep && "text-foreground font-bold bg-primary/10",
                          i > mapStep && "text-muted-foreground"
                        )}>
                          <div className={cn("size-1.5 rounded-full shrink-0", i < mapStep ? "bg-green-500" : i === mapStep ? "bg-primary" : "bg-border")} />
                          <span>{label} <span className="font-normal text-muted-foreground">&mdash; {desc}</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-card border border-border/60 rounded-lg p-3">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Quick Prompts</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ["Open", "Can you tell me more about what brought you in today?"],
                        ["Timing", "When did this start, and what were you doing?"],
                        ["Severity", "On a scale of 1-10, how bad is it?"],
                        ["Triggers", "Does anything make it better or worse?"],
                        ["PMH/Meds", "Do you have any medical conditions or take regular medicines?"],
                        ["ICE", "Is there anything you are particularly worried this might be?"],
                        ["Family Hx", "Does this run in your family?"],
                      ].map(([label, prompt]) => (
                        <button
                          key={label}
                          onClick={() => insertPrompt(prompt)}
                          className="px-2 py-1 rounded-full border border-border/60 bg-card text-[11px] font-semibold text-muted-foreground hover:border-primary/60 hover:text-foreground hover:bg-primary/5 transition-colors active:scale-95"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </aside>
          )}

          {/* Chat Zone */}
          <div className="flex-1 min-w-0 flex flex-col bg-gradient-to-b from-background via-card/30 to-card/40">
            {/* Transcript */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
              {transcript.map((m, i) => {
                const isModel = m.role === "model";
                const label = isDataInterp
                  ? (isModel ? `${activeCase.examiner?.name || "Examiner"}` : "You")
                  : (isModel ? speaker.name : "You");
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className={cn("flex flex-col max-w-[82%] md:max-w-[650px]", isModel ? "self-start" : "self-end items-end")}
                  >
                    <div className={cn("text-[9px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1", isModel ? "text-sky-500" : "text-primary")}>
                      {isModel ? <Stethoscope className="size-3" /> : <Activity className="size-3" />}
                      {label}
                    </div>
                    <div className={cn(
                      "px-3 py-2 rounded-xl text-sm leading-relaxed",
                      isModel
                        ? "bg-card border border-border/60 shadow-sm"
                        : "bg-primary/10 border border-primary/20 shadow-sm"
                    )}
                      dangerouslySetInnerHTML={{ __html: md(m.text) }} />
                  </motion.div>
                );
              })}

              {/* Thinking indicator */}
              <AnimatePresence>
                {thinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="self-start"
                  >
                    <div className="text-[9px] font-bold uppercase tracking-wider text-sky-500 mb-1 flex items-center gap-1">
                      <Stethoscope className="size-3" />
                      {isDataInterp ? (activeCase.examiner?.name || "Examiner") : speaker.name}
                    </div>
                    <div className="bg-card border border-border/60 rounded-xl px-3 py-2.5 inline-flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="size-1.5 rounded-full bg-sky-500 animate-bounce" style={{ animationDelay: "0s" }} />
                        <span className="size-1.5 rounded-full bg-sky-500 animate-bounce" style={{ animationDelay: "0.15s" }} />
                        <span className="size-1.5 rounded-full bg-sky-500 animate-bounce" style={{ animationDelay: "0.3s" }} />
                      </div>
                      <span className="text-xs text-muted-foreground italic">{isDataInterp ? "evaluating\u2026" : "typing\u2026"}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Error bar */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mx-3 mb-1"
                >
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-500">
                    <AlertCircle className="size-3.5 shrink-0" />
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input area */}
            <div className="bg-card border-t border-border/60 shrink-0">
              {/* Voice bar */}
              <div className="flex items-center justify-center gap-2 px-3 py-1.5 border-b border-border/60 bg-muted/20 min-h-[34px]">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold transition-colors min-w-0"
                  style={{
                    color: voicePhase === "speaking" ? "#38bdf8" :
                           voicePhase === "listening" ? "#da3633" :
                           voiceOn ? "#8b949e" : "#6e7681"
                  }}>
                  <div className="size-1.5 rounded-full shrink-0"
                    style={{
                      background: voicePhase === "speaking" ? "#38bdf8" :
                                  voicePhase === "listening" ? "#da3633" :
                                  "#6e7681",
                      animation: (voicePhase === "listening" || voicePhase === "speaking") ? "pulse 0.8s infinite" : "none",
                    }} />
                  <span className="truncate">{
                    voicePhase === "speaking" ? "Patient speaking\u2026" :
                    voicePhase === "listening" ? "Listening \u2014 your turn" :
                    voiceOn ? "Mic ready" :
                    "Voice off"
                  }</span>
                </div>
                {/* Waveform bars */}
                {(voicePhase === "listening" || voicePhase === "speaking") && (
                  <div className="flex items-end gap-px h-4 ml-1"
                    style={{ display: "flex" }}>
                    {[1.2, 1.8, 2.4, 1.6, 1.0].map((h, i) => (
                      <div key={i}
                        style={{
                          width: 3,
                          height: h * 6 + 4,
                          borderRadius: 2,
                          background: voicePhase === "listening" ? "#da3633" : "#38bdf8",
                          animation: `w${i + 1} 0.7s ease-in-out infinite`,
                        }} />
                    ))}
                  </div>
                )}
                {interimText && (
                  <span className="text-[10px] text-muted-foreground italic ml-1 truncate max-w-[180px] shrink min-w-0">
                    {interimText}
                  </span>
                )}
              </div>

              {/* Input row */}
              <div className="flex items-end gap-2 px-3 py-2">
                <button
                  onClick={toggleVoice}
                  className={cn(
                    "size-11 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                    voiceOn ? "bg-red-500 border-red-500 text-white animate-pulse" : "border-border/60 bg-muted/40 text-muted-foreground hover:border-primary/60 hover:text-primary hover:bg-primary/5"
                  )}
                  title={voiceOn ? "Disable voice" : "Enable voice"}
                >
                  {voiceOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
                </button>
                <textarea
                  ref={inputRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={isDataInterp ? "Answer the examiner\u2019s question\u2026" : "Ask the patient a question\u2026"}
                  rows={1}
                  className="flex-1 resize-none min-h-[42px] max-h-[120px] px-3 py-2.5 rounded-lg border border-border/60 bg-background text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all leading-relaxed placeholder:text-muted-foreground"
                  style={{ height: "auto", minHeight: "42px" }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = Math.min(120, el.scrollHeight) + "px";
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !inputText.trim()}
                  className="h-11 px-4 rounded-lg bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 shrink-0 flex items-center gap-1.5"
                >
                  {sending ?
                    <Loader2 className="size-4 animate-spin" /> :
                    <><Send className="size-3.5" /> Send</>
                  }
                </button>
              </div>

              {/* Bottom row */}
              <div className="flex items-center gap-2 px-3 pb-2">
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full border tabular-nums transition-all",
                  turnCount >= WARN_TURNS ? "border-red-500/40 text-red-500 bg-red-500/10" :
                  turnCount >= Math.floor(WARN_TURNS * 0.7) ? "border-amber-500/40 text-amber-500 bg-amber-500/10" :
                  "border-border/60 text-muted-foreground bg-muted/40"
                )}>
                  Q {turnCount}/{MAX_TURNS}
                </span>
                <button
                  onClick={handleSubmit}
                  disabled={sending || thinking || !transcript.length}
                  className="flex-1 h-8 px-3 rounded-lg border border-border/60 bg-muted/40 text-foreground font-semibold text-[11px] hover:border-sky-500/60 hover:text-sky-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Submit for Examiner Feedback
                </button>
                <button
                  onClick={() => setResetModalOpen(true)}
                  className="h-8 px-3 rounded-lg border border-border/60 bg-muted/40 text-muted-foreground text-[11px] font-medium hover:border-red-500/60 hover:text-red-500 transition-all flex items-center gap-1"
                >
                  <RotateCcw className="size-3" /> Reset
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Reset Modal */}
        <AnimatePresence>
          {resetModalOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
              onClick={() => setResetModalOpen(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-card border border-border/60 rounded-2xl p-6 max-w-sm w-full text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-bold font-serif mb-1">Reset Consultation?</h3>
                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">This will clear the entire conversation, timer, and progress. This cannot be undone.</p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setResetModalOpen(false)} className="h-9 px-4 rounded-lg border border-border/60 bg-muted/40 text-foreground font-semibold text-sm hover:border-primary/60 transition-colors">
                    Go Back
                  </button>
                  <button onClick={handleReset} className="h-9 px-4 rounded-lg border border-red-500/60 text-red-500 font-semibold text-sm hover:bg-red-500/10 transition-colors">
                    Reset Now
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings Modal */}
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </div>
    );
  }

  /* ── Debrief Phase ──────────────────────────────────────────── */

  if (phase === "debrief" && result) {
    const hp = activeCase.hiddenProfile;
    const band = result.score >= 90 ? "Outstanding" : result.score >= 75 ? "Strong pass" : result.score >= 60 ? "Clear pass" : result.score >= 40 ? "Needs improvement" : "Restart recommended";

    const domainDefs = isDataInterp
      ? [{ k: "knowledge", l: "Knowledge", m: 30 }, { k: "interpretation", l: "Interpretation", m: 30 }, { k: "reasoning", l: "Reasoning", m: 25 }, { k: "communication", l: "Communication", m: 15 }]
      : [{ k: "communication", l: "Communication", m: 25 }, { k: "infoGathering", l: "Info Gathering", m: 25 }, { k: "clinicalReasoning", l: "Clinical Reasoning", m: 25 }, { k: "professionalism", l: "Professionalism", m: 25 }];

    const domColors = ["#38bdf8", "#f0a500", "#8b5cf6", "#2ea043"];

    const badges = buildAchievements(result, timeUsedPct, turnCount);

    return (
      <div className="h-full bg-background/80 overflow-y-auto">
        <div className="min-h-full flex items-start justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-2xl bg-card border border-border/60 rounded-2xl shadow-lg my-4"
          >
            <div className="p-5 space-y-5">

              {/* Score banner */}
              <div className="bg-card border border-border/60 rounded-2xl p-5 flex items-center gap-6 flex-wrap shadow-sm">
                <div className="size-24 rounded-full border-4 border-primary flex flex-col items-center justify-center bg-primary/10 shrink-0">
                  <div className="text-2xl font-bold text-primary leading-tight">{result.score}%</div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Score</div>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <h3 className="text-lg font-bold font-serif mb-3">{band}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { val: timeUsedPct + "%", label: "Time Used", color: "text-green-500" },
                      { val: String(turnCount), label: "Turns", color: "text-sky-500" },
                      { val: String(result.asked.length), label: "Covered", color: "text-green-500" },
                      { val: String(result.missed.length), label: "Missed", color: "text-red-500" },
                    ].map((s) => (
                      <div key={s.label} className="bg-muted/30 border border-border/60 rounded-lg p-2">
                        <div className={cn("text-sm font-bold tabular-nums", s.color)}>{s.val}</div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Domain Scores */}
              <div className="border border-border/60 rounded-2xl p-4 bg-card shadow-sm">
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                  <Activity className="size-3" /> Domain Scores
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {domainDefs.map((dd, i) => {
                    const v = (result.domains[dd.k] || 0);
                    const pct = (v / dd.m) * 100;
                    const q = pct >= 70 ? "good" : pct >= 40 ? "avg" : "low";
                    return (
                      <div key={dd.k} className={cn(
                        "bg-muted/30 border border-border/60 rounded-lg p-2.5",
                        q === "good" && "border-green-500/20",
                        q === "avg" && "border-amber-500/20",
                        q === "low" && "border-red-500/20"
                      )}>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{dd.l}</div>
                        <div className={cn(
                          "text-base font-bold tabular-nums",
                          q === "good" && "text-green-500",
                          q === "avg" && "text-amber-500",
                          q === "low" && "text-red-500"
                        )}>
                          {v} <span className="text-xs font-normal text-muted-foreground">/ {dd.m}</span>
                        </div>
                        <div className="h-1 rounded-full bg-border/40 mt-1 overflow-hidden">
                          <div className={cn(
                            "h-full rounded-full",
                            q === "good" && "bg-green-500",
                            q === "avg" && "bg-amber-500",
                            q === "low" && "bg-red-500"
                          )} style={{ width: pct + "%" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Radar Chart */}
              <div className="border border-border/60 rounded-2xl p-4 bg-card shadow-sm">
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                  <Activity className="size-3" /> Performance Radar
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <svg className="size-36 shrink-0" viewBox="0 0 160 160" dangerouslySetInnerHTML={{ __html: buildRadarSVG(result.domains, isDataInterp) }} />
                  <div className="flex flex-col gap-1.5">
                    {domainDefs.map((dd, i) => (
                      <div key={dd.k} className="flex items-center gap-2 text-[11px]">
                        <div className="size-2 rounded-full" style={{ background: domColors[i] }} />
                        <span>{dd.l}</span>
                        <span className="ml-auto font-bold tabular-nums">{(result.domains[dd.k] || 0)}/{dd.m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Feedback */}
              <div className="border border-border/60 rounded-2xl p-4 bg-card shadow-sm">
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                  <Lightbulb className="size-3" /> Examiner Feedback
                </div>
                <div className="bg-muted/30 border border-border/60 rounded-lg p-3 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: md(result.feedback) }} />
                <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs">
                  <Stethoscope className="size-3.5 shrink-0" />
                  <div><strong className="text-sky-500">Hidden diagnosis:</strong> {hp.diagnosis || "(not specified)"}</div>
                </div>
              </div>

              {/* Criteria */}
              <div className="border border-border/60 rounded-2xl p-4 bg-card shadow-sm">
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                  <AlignLeft className="size-3" /> Criteria Review
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-green-500 mb-1.5">Covered ({result.asked.length})</h4>
                    <ul className="space-y-0.5">
                      {(result.asked.length ? result.asked : ["(none matched)"]).map((x, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs px-2 py-1 rounded bg-green-500/10 text-green-500 border-l-2 border-green-500">
                          <Check className="size-3 mt-0.5 shrink-0" /> {x}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-red-500 mb-1.5">Missed ({result.missed.length})</h4>
                    <ul className="space-y-0.5">
                      {(result.missed.length ? result.missed : ["(nothing missed \u2014 excellent coverage)"]).map((x, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs px-2 py-1 rounded bg-red-500/10 text-red-500 border-l-2 border-red-500">
                          <X className="size-3 mt-0.5 shrink-0" /> {x}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Achievements */}
              {badges.length > 0 && (
                <div className="border border-border/60 rounded-2xl p-4 bg-card shadow-sm">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                    <Lightbulb className="size-3" /> Achievements
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {badges.map((b, i) => (
                      <div key={i} className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border",
                        b.color === "gold" && "border-amber-500/40 bg-amber-500/10 text-amber-500",
                        b.color === "green" && "border-green-500/40 bg-green-500/10 text-green-500",
                        b.color === "blue" && "border-sky-500/40 bg-sky-500/10 text-sky-500",
                        b.color === "purple" && "border-purple-500/40 bg-purple-500/10 text-purple-500",
                      )}>
                        <span>{b.icon}</span>
                        <span>{b.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 flex-wrap pt-2">
                <button
                  onClick={() => {
                    stopTimer();
                    setResult(null);
                    setPhase("conversation");
                  }}
                  className="h-10 px-5 rounded-lg border border-border/60 bg-muted/40 text-foreground font-semibold text-sm hover:border-primary/60 transition-colors flex items-center gap-2"
                >
                  <ChevronLeft className="size-3.5" /> Back to Consultation
                </button>
                <button
                  onClick={handleReset}
                  className="h-10 px-5 rounded-lg bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition-all flex items-center gap-2"
                >
                  <RefreshCw className="size-3.5" /> Try Again
                </button>
                <button
                  onClick={onExit}
                  className="h-10 px-5 rounded-lg border border-border/60 bg-muted/40 text-foreground font-semibold text-sm hover:border-primary/60 transition-colors flex items-center gap-2"
                >
                  <Home className="size-3.5" /> Back to Hub
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return null;
}

/* ── Settings Modal ───────────────────────────────────────────────── */

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = React.useState("");
  const [testing, setTesting] = React.useState(false);

  const MODELS_LIST = MODELS;
  const LIVE_MODELS_LIST = LIVE_MODELS;

  function getVal(key: string, fallback: string): string {
    return typeof window !== "undefined" ? localStorage.getItem(key) || fallback : fallback;
  }

  function setVal(key: string, value: string) {
    if (typeof window !== "undefined") localStorage.setItem(key, value);
  }

  function handleSaveKey() {
    const v = (document.getElementById("osce-key-input") as HTMLInputElement)?.value?.trim() || "";
    setVal(API_KEY, v);
    setStatus(v ? "Key saved." : "Key cleared.");
    setTimeout(() => { setStatus(""); onClose(); }, 1000);
  }

  function handleClearKey() {
    setVal(API_KEY, "");
    const el = document.getElementById("osce-key-input") as HTMLInputElement;
    if (el) el.value = "";
    setStatus("Key cleared.");
  }

  async function handleTestKey() {
    const v = (document.getElementById("osce-key-input") as HTMLInputElement)?.value?.trim();
    if (!v) { setStatus("No key entered."); return; }
    setTesting(true);
    setStatus("Testing\u2026");
    try {
      const res = await fetch(`${GEMINI_BASE}/models?key=${v}`);
      const data = await res.json();
      if (data?.models?.length) {
        setStatus(`Valid key (${data.models.length} models).`);
      } else {
        setStatus("Unexpected response.");
      }
    } catch {
      setStatus("Connection failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-card border border-border/60 rounded-xl w-full max-w-md max-h-[92vh] overflow-y-auto shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <h3 className="text-sm font-bold font-serif">AI & Voice Settings</h3>
          <button onClick={onClose} className="size-7 rounded-lg hover:bg-muted/60 flex items-center justify-center">
            <X className="size-3.5" />
          </button>
        </div>
        <div className="p-4 space-y-4">

          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60 pb-1">Gemini API</div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">API Key</label>
            <input
              id="osce-key-input"
              type="password"
              defaultValue={getVal(API_KEY, "")}
              placeholder="Enter your Gemini API key"
              className="w-full h-9 rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary transition-colors"
            />
            <p className="text-[10px] text-muted-foreground">
              Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" className="text-primary underline">AI Studio</a>.
            </p>
            <div className="flex gap-2">
              <button onClick={handleSaveKey} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90">Save</button>
              <button onClick={handleClearKey} className="h-8 px-3 rounded-lg border border-border/60 text-xs font-semibold hover:border-primary/60">Clear</button>
              <button onClick={handleTestKey} disabled={testing} className="h-8 px-3 rounded-lg border border-border/60 text-xs font-semibold hover:border-primary/60 disabled:opacity-50">
                {testing ? "Testing\u2026" : "Test"}
              </button>
            </div>
            {status && <p className="text-[11px] text-muted-foreground">{status}</p>}
          </div>

          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60 pb-1">AI Model</div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Model</label>
            <select
              defaultValue={getVal(API_MODEL, MODELS[0][0])}
              onChange={(e) => setVal(API_MODEL, e.target.value)}
              className="w-full h-9 rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {MODELS_LIST.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Max Wait</label>
            <select
              defaultValue={getVal(API_MAX_WAIT, "15")}
              onChange={(e) => setVal(API_MAX_WAIT, e.target.value)}
              className="w-full h-9 rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value="15">15 seconds</option>
              <option value="30">30 seconds</option>
              <option value="60">60 seconds</option>
              <option value="0">No limit</option>
            </select>
          </div>

          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60 pb-1">Live Model (Voice)</div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Live Model</label>
            <select
              defaultValue={getVal(LIVE_MODEL_KEY, LIVE_MODELS[0][0])}
              onChange={(e) => setVal(LIVE_MODEL_KEY, e.target.value)}
              className="w-full h-9 rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {LIVE_MODELS_LIST.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">TTS Rate</label>
            <select
              defaultValue={getVal(STORAGE.ttsRate, "0.95")}
              onChange={(e) => setVal(STORAGE.ttsRate, e.target.value)}
              className="w-full h-9 rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value="0.5">Very Slow (0.5x)</option>
              <option value="0.75">Slow (0.75x)</option>
              <option value="0.95">Normal (0.95x)</option>
              <option value="1.2">Fast (1.2x)</option>
              <option value="1.5">Very Fast (1.5x)</option>
            </select>
          </div>

        </div>
        <div className="px-4 py-3 border-t border-border/60 flex justify-end">
          <button onClick={onClose} className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:opacity-90">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Data Tables Renderer ─────────────────────────────────────────── */

function DataTablesRenderer({ tables }: { tables?: OsceDataTable[] }) {
  const [open, setOpen] = React.useState(false);
  if (!tables || !tables.length) return null;
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg border border-border/60 bg-muted/30 text-xs font-semibold flex items-center justify-between hover:border-primary/60 transition-colors"
      >
        Lab Data <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {tables.map((t, i) => (
            <div key={i} className="bg-muted/20 border border-border/60 rounded-lg p-2 overflow-x-auto">
              {t.title && <div className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">{t.title}</div>}
              <table className="w-full text-[11px]">
                {t.headers && t.headers.length > 0 && (
                  <thead>
                    <tr>
                      {t.headers.map((h, hi) => (
                        <th key={hi} className="text-left px-1.5 py-1 font-bold text-foreground border-b border-border/40 uppercase tracking-wider text-[9px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {(t.rows || []).map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td key={ci} className={cn("px-1.5 py-1 border-b border-border/20", ci === r.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground")}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Data Images Renderer ─────────────────────────────────────────── */

function DataImagesRenderer({ images }: { images?: OsceDataImage[] }) {
  const [open, setOpen] = React.useState(false);
  if (!images || !images.length) return null;
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg border border-border/60 bg-muted/30 text-xs font-semibold flex items-center justify-between hover:border-primary/60 transition-colors"
      >
        Clinical Images ({images.length}) <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {images.map((im, i) => {
            const src = im.src || im.url || "";
            if (!src) return null;
            return (
              <div key={i} className="bg-muted/20 border border-border/60 rounded-lg overflow-hidden">
                {im.title && <div className="text-[10px] font-bold text-primary uppercase tracking-wider px-2 pt-2">{im.title}</div>}
                <img src={src} alt={im.alt || im.caption || ""} className="w-full max-h-80 object-contain bg-black" loading="lazy" />
                {im.caption && <div className="text-[10px] text-muted-foreground px-2 pb-2 pt-1">{im.caption}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
