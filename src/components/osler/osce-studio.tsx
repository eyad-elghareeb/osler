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
  Home,
  Activity,
  Lightbulb,
  RefreshCw,
  Volume2,
  VolumeX,
  Loader2,
  AlertCircle,
  AlignLeft,
  Search,
  Tag,
  BarChart3,
  ArrowRight,
  Play,
  type LucideIcon,
} from "lucide-react";
import { loadAllContent } from "@/lib/osler/content";
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
  return l.includes("found") || l === "easy"
    ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10"
    : l.includes("adv") || l === "hard"
    ? "border-red-500/30 text-red-500 bg-red-500/10"
    : "border-amber-500/30 text-amber-500 bg-amber-500/10";
}

function userTurnCount(transcript: TranscriptEntry[]): number {
  let c = 0;
  for (const m of transcript) if (m.role === "user") c++;
  return c;
}

function sanitizeModelText(text: string): string {
  return text
    .replace(/This response is not intended to be medical advice[^.]*(?:consult|professional|treatment)[^.]*\./gi, "")
    .trim();
}

function isPediatric(age: number): boolean {
  return age < 16;
}

function md(text: string): string {
  if (!text) return "";
  let h = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\n/g, "<br>");
  return h;
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
    "The JSON object must contain exactly these keys:",
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
  lines.push("");
  lines.push("Score this transcript. Return JSON only.");
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
    "Keep a mental score out of 100. Do NOT share it."
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

function scoreDataInterp(raw: string): ExamResult | null {
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

function getLiveModel(): string {
  return localStorage.getItem(LIVE_MODEL_KEY) || LIVE_MODELS[0][0];
}

async function callGemini(
  systemPrompt: string,
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  signal?: AbortSignal
): Promise<string> {
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
  const contents = transcript.map((m) => ({
    role: m.role === "model" ? "model" : "user",
    parts: [{ text: m.text }],
  }));
  return callGemini(buildPatientSysPrompt(c), contents, signal);
}

async function askExaminer(c: OsceStation, transcript: TranscriptEntry[], signal?: AbortSignal): Promise<string> {
  const contents = transcript.map((m) => ({
    role: m.role === "model" ? "model" : "user",
    parts: [{ text: m.text }],
  }));
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

/* ── Achievements Builder ──────────────────────────────────────────── */

function buildAchievements(result: ExamResult, timeUsedPct: number, turnCount: number): Achievement[] {
  const b: Achievement[] = [];
  if (result.score >= 80) b.push({ icon: "🌟", label: "Outstanding", desc: "Score ≥ 80", color: "gold" });
  else if (result.score >= 50) b.push({ icon: "✅", label: "Passed", desc: "Station passed", color: "green" });
  if (result.missed.length === 0 && result.asked.length > 0)
    b.push({ icon: "🎯", label: "Full Coverage", desc: "All criteria covered", color: "green" });
  if ((result.domains.communication || 0) >= 22)
    b.push({ icon: "💬", label: "Communicator", desc: "Communication ≥ 22/25", color: "blue" });
  if ((result.domains.professionalism || 0) >= 22)
    b.push({ icon: "🎖", label: "Professional", desc: "Professionalism ≥ 22/25", color: "blue" });
  if ((result.domains.clinicalReasoning || 0) >= 22)
    b.push({ icon: "🧠", label: "Clinician", desc: "Clinical reasoning ≥ 22/25", color: "purple" });
  if ((result.domains.infoGathering || 0) >= 22)
    b.push({ icon: "🔍", label: "Thorough", desc: "Info gathering ≥ 22/25", color: "purple" });
  if (timeUsedPct < 65 && result.score >= 50)
    b.push({ icon: "⚡", label: "Efficient", desc: "Completed quickly", color: "gold" });
  if (turnCount >= 15 && result.score >= 50)
    b.push({ icon: "💪", label: "Persistent", desc: "15+ questions asked", color: "blue" });
  return b;
}

/* ── Confetti ──────────────────────────────────────────────────────── */

function launchConfetti() {
  if (typeof window === "undefined") return;
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:9999;width:100%;height:100%";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const colors = ["#f0a500", "#38bdf8", "#2ea043", "#8b5cf6", "#da3633", "#fff"];
  const particles = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height * 0.5,
    w: 6 + Math.random() * 8,
    h: 3 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 4,
    vy: 2 + Math.random() * 5,
    rot: Math.random() * 360,
    vrot: (Math.random() - 0.5) * 8,
    alpha: 1,
  }));
  let start: number | null = null;
  function frame(ts: number) {
    if (!start) start = ts;
    const elapsed = ts - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.y += p.vy;
      p.x += p.vx;
      p.rot += p.vrot;
      if (elapsed > 2200) p.alpha = Math.max(0, p.alpha - 0.03);
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (elapsed < 3500) requestAnimationFrame(frame);
    else if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
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

/* ── OSCE Studio Component ───────────────────────────────────────── */

export function OsceStudio({ activeItem, activeContent, onExit, onOpenPack }: OsceStudioProps) {
  const isMobile = useIsMobile();

  /* ── State ── */
  const [allPacks, setAllPacks] = React.useState<Array<{ item: ManifestItem; content: OsceContent }>>([]);
  const [packsLoading, setPacksLoading] = React.useState(true);
  const [packSearch, setPackSearch] = React.useState("");
  const [stations, setStations] = React.useState<OsceStation[]>([]);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [phase, setPhase] = React.useState<OscePhase>("select");
  const [transcript, setTranscript] = React.useState<TranscriptEntry[]>([]);
  const [timerRemaining, setTimerRemaining] = React.useState(EXAM_TIME);
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
  const [selectedPackUid, setSelectedPackUid] = React.useState<string | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);
  const transcriptRef = React.useRef<TranscriptEntry[]>([]);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = React.useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const SIDEBAR_WIDTH = 220;

  const voicePhaseRef = React.useRef(voicePhase);
  React.useEffect(() => {
    voicePhaseRef.current = voicePhase;
  }, [voicePhase]);

  /* Sync transcript ref */
  React.useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  /* Load all OSCE packs */
  React.useEffect(() => {
    setPacksLoading(true);
    loadAllContent()
      .then(({ items }) => {
        const oscePacks: Array<{ item: ManifestItem; content: OsceContent }> = [];
        for (const { item, content } of items) {
          if (content?.type === "osce") {
            oscePacks.push({ item, content: content as OsceContent });
          }
        }
        setAllPacks(oscePacks);
      })
      .catch(() => {})
      .finally(() => setPacksLoading(false));
  }, []);

  /* If a pack is injected from outside (library/dashboard), go straight to lobby */
  React.useEffect(() => {
    if (activeContent && activeContent.type === "osce") {
      const normalized = activeContent.stations.map((s, i) =>
        normalizeStation(s as unknown as Record<string, unknown>, i)
      );
      setStations(normalized);
      setActiveIdx(0);
      setPhase("lobby");
    }
  }, [activeContent]);

  const activeCase = stations[activeIdx] || null;

  /* ── Gemini Live Voice System ────────────────────────── */

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
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Microphone not accessible.");
      return;
    }
    setVoicePhase("listening");
    const modelName = getLiveModel();
    const apiKey = getApiKey();
    const wsUrl =
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" +
      apiKey;
    const ws = new WebSocket(wsUrl);
    liveSessionRef.current = ws;

    ws.onopen = () => {
      const sysPrompt =
        activeCase && activeCase.type === "data-interp"
          ? buildDataInterpSysPrompt(activeCase)
          : buildPatientSysPrompt(activeCase!);
      ws.send(
        JSON.stringify({
          setup: {
            model: "models/" + modelName,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: getGenderVoice() } },
              },
              temperature: 1.0,
            },
            systemInstruction: { parts: [{ text: sysPrompt }] },
          },
        })
      );
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
          sc.modelTurn.parts.forEach(
            (part: { inlineData?: { mimeType: string; data: string } }) => {
              if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.includes("audio")) {
                playLiveAudio(part.inlineData.data, part.inlineData.mimeType);
              }
            }
          );
        }
        if (sc.interrupted) {
          if (livePlayCtxRef.current) {
            try { livePlayCtxRef.current.close(); } catch {}
            livePlayCtxRef.current = null;
          }
          livePlayScheduleTimeRef.current = 0;
          liveModelAccumTextRef.current = "";
          setVoicePhase("listening");
        }
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
    if (liveSessionRef.current) {
      try { liveSessionRef.current.close(); } catch {}
      liveSessionRef.current = null;
    }
    if (livePlayCtxRef.current) {
      try { livePlayCtxRef.current.close(); } catch {}
      livePlayCtxRef.current = null;
    }
    if (liveAudioCtxRef.current) {
      try { liveAudioCtxRef.current.close(); } catch {}
      liveAudioCtxRef.current = null;
    }
    setInterimText("");
    setVoicePhase("idle");
  }

  function startLiveMic() {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        liveMicStreamRef.current = stream;
        const actx = new (window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext)({ sampleRate: 16000 }) as AudioContext;
        liveAudioCtxRef.current = actx;
        const source = actx.createMediaStreamSource(stream);
        const processorCode =
          "class MicProcessor extends AudioWorkletProcessor{process(inputs){this.port.postMessage(inputs[0][0]);return true;}}registerProcessor('mic-processor',MicProcessor);";
        const blob = new Blob([processorCode], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        actx.audioWorklet.addModule(url).then(() => {
          const node = new AudioWorkletNode(actx, "mic-processor");
          node.port.onmessage = (e) => {
            if (!liveSessionRef.current || liveSessionRef.current.readyState !== WebSocket.OPEN) return;
            // Skip sending microphone data while the model is actively speaking to prevent echo/choppiness
            if (voicePhaseRef.current === "speaking") return;

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
      })
      .catch((err) => {
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
        // Skip sending microphone data while the model is actively speaking to prevent echo/choppiness
        if (voicePhaseRef.current === "speaking") return;

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
    } catch {
      stopGeminiLive();
      setError("Microphone init failed.");
    }
  }

  function stopLiveMic() {
    if (liveMicProcessorRef.current) {
      try { (liveMicProcessorRef.current as AudioNode).disconnect(); } catch {}
      liveMicProcessorRef.current = null;
    }
    if (liveMicStreamRef.current) {
      liveMicStreamRef.current.getTracks().forEach((t) => t.stop());
      liveMicStreamRef.current = null;
    }
  }

  function playLiveAudio(b64data: string, mimeType: string) {
    try {
      // If we are actively listening to the user, discard any leftover/delayed audio chunks from the server
      if (voicePhaseRef.current === "listening") return;

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

      // A 150ms delay offset provides a lookahead queue window to absorb network jitter smoothly
      const startDelay = 0.15;
      const when =
        livePlayScheduleTimeRef.current > ctx.currentTime
          ? livePlayScheduleTimeRef.current
          : ctx.currentTime + startDelay;
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
      liveSessionRef.current.send(
        JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } })
      );
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
      stopGeminiLive();
      startGeminiLive();
    }
  }

  function stopSpeaking() {
    if (livePlayCtxRef.current) {
      try { livePlayCtxRef.current.close(); } catch {}
      livePlayCtxRef.current = null;
    }
    livePlayScheduleTimeRef.current = 0;
    setVoicePhase("idle");
  }

  /* TTS fallback */
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
      const preferred = voices.find(
        (v) => /en.gb/i.test(v.lang) || /daniel|samantha|karen|moira/i.test(v.name)
      );
      if (preferred) utt.voice = preferred;
    }
    utt.rate = parseFloat(localStorage.getItem(STORAGE.ttsRate) || "0.95");
    utt.pitch = 1;
    utt.onend = () => { setVoicePhase(voiceOnRef.current ? "listening" : "idle"); };
    utt.onerror = () => { setVoicePhase(voiceOnRef.current ? "listening" : "idle"); };
    window.speechSynthesis.speak(utt);
  }

  /* Init voice when entering conversation */
  React.useEffect(() => {
    if (phase !== "conversation") return;
    const on = localStorage.getItem(STORAGE.voiceOn) === "true";
    setVoiceOn(on);
    if (on) setTimeout(startGeminiLive, 500);
    return () => { stopGeminiLive(); };
  }, [phase]);

  /* ── Timer — auto-starts when entering conversation ── */
  React.useEffect(() => {
    if (phase !== "conversation") return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimerRemaining((prev) => {
        const next = Math.max(0, prev - 1);
        if (next <= 0) clearInterval(timerRef.current!);
        return next;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  /* Session save/load */
  function sessionKey(): string {
    return STORAGE.session + (activeItem?.uid || selectedPackUid || "osce");
  }

  function saveSession() {
    if (!activeCase || !transcript.length) return;
    try {
      localStorage.setItem(sessionKey(), JSON.stringify({ transcript, timerRemaining }));
    } catch {}
  }

  function loadSession(): { transcript: TranscriptEntry[]; timerRemaining: number } | null {
    try {
      const r = localStorage.getItem(sessionKey());
      return r ? JSON.parse(r) : null;
    } catch { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem(sessionKey()); } catch {}
  }

  /* Scroll to bottom */
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript, thinking]);

  /* Keyboard Escape */
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase === "conversation") {
        if (resetModalOpen) { setResetModalOpen(false); return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, resetModalOpen]);

  /* Waveform keyframes */
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("osce-wavestyles")) return;
    const st = document.createElement("style");
    st.id = "osce-wavestyles";
    st.textContent =
      "@keyframes w1{0%,100%{height:4px}50%{height:18px}}@keyframes w2{0%,100%{height:9px}50%{height:26px}}@keyframes w3{0%,100%{height:6px}50%{height:22px}}";
    document.head.appendChild(st);
  }, []);

  /* ── Phase: Select (Scenario Picker) ──────────────────────── */

  function selectPack(pack: { item: ManifestItem; content: OsceContent }) {
    const normalized = pack.content.stations.map((s, i) =>
      normalizeStation(s as unknown as Record<string, unknown>, i)
    );
    setStations(normalized);
    setActiveIdx(0);
    setSelectedPackUid(pack.item.uid);
    setTranscript([]);
    setResult(null);
    setError(null);
    setTimerRemaining(normalized[0]?.time || EXAM_TIME);
    setPhase("lobby");
  }

  const filteredPacks = React.useMemo(() => {
    if (!packSearch.trim()) return allPacks;
    const q = packSearch.toLowerCase();
    return allPacks.filter(
      ({ item, content }) =>
        item.title.toLowerCase().includes(q) ||
        item.tags?.some((t) => t.toLowerCase().includes(q)) ||
        content.meta.description?.toLowerCase().includes(q)
    );
  }, [allPacks, packSearch]);

  if (phase === "select") {
    return (
      <div className="h-full overflow-y-auto medos-scroll">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Page header */}
            <div className="flex items-center gap-3 mb-2">
              <div className="size-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                <Stethoscope className="size-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">OSCE Studio</h1>
                <p className="text-xs text-muted-foreground">
                  Virtual patient simulator · Choose a scenario to begin
                </p>
              </div>
            </div>

            {/* Search */}
            <div className="relative mt-5 mb-6">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <input
                value={packSearch}
                onChange={(e) => setPackSearch(e.target.value)}
                placeholder="Search scenarios by title, specialty, or tag…"
                className="w-full h-10 pl-9 pr-4 rounded-lg border border-border/60 bg-card text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
              />
            </div>

            {/* Pack grid */}
            {packsLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <Loader2 className="size-7 animate-spin text-primary" />
                <span className="text-sm">Loading scenarios…</span>
              </div>
            ) : filteredPacks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <Stethoscope className="size-12 text-muted-foreground/40" />
                <div>
                  <p className="font-semibold text-sm mb-1">No OSCE scenarios found</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    {packSearch
                      ? `No results for "${packSearch}". Try a different search.`
                      : "Add OSCE content packs to the library to get started."}
                  </p>
                </div>
                <button
                  onClick={onExit}
                  className="h-9 px-4 rounded-md border border-border/60 text-sm font-medium hover:bg-muted/60 transition-colors"
                >
                  Back to Dashboard
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredPacks.map(({ item, content }, idx) => {
                  const stationCount = content.stations?.length || 0;
                  const tags = item.tags?.slice(0, 4) || [];
                  return (
                    <motion.div
                      key={item.uid}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: idx * 0.04 }}
                    >
                      <button
                        onClick={() => selectPack({ item, content })}
                        className="w-full text-left group relative overflow-hidden bg-card border border-border/60 rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all duration-200 active:scale-[0.99]"
                      >
                        {/* Top accent line */}
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 to-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />

                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                            <Stethoscope className="size-4 text-primary" />
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                              {stationCount} {stationCount === 1 ? "station" : "stations"}
                            </span>
                            <ArrowRight className="size-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                          </div>
                        </div>

                        <h3 className="font-semibold text-sm mb-1 group-hover:text-primary transition-colors leading-snug">
                          {item.title}
                        </h3>
                        {content.meta.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-relaxed">
                            {content.meta.description}
                          </p>
                        )}

                        {tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {tags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/60"
                              >
                                <Tag className="size-2.5" />
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    );
  }

  /* ── Lobby Screen ──────────────────────────────────────────── */

  if (phase === "lobby" && activeCase) {
    const p = activeCase.patient;
    const isDataInterp = activeCase.type === "data-interp";
    const dur = Math.floor((activeCase.time || EXAM_TIME) / 60);
    const stationDuration = activeCase.time || EXAM_TIME;

    function startConsultation() {
      const saved = loadSession();
      if (saved && saved.transcript && saved.transcript.length) {
        setTranscript(saved.transcript);
        setTimerRemaining(saved.timerRemaining || stationDuration);
      } else {
        setTranscript([]);
        setTimerRemaining(stationDuration);
      }
      setRenderedCount(0);
      setResult(null);
      setError(null);
      setPhase("conversation");
    }

     return (
      <div className="fixed inset-0 z-50 bg-background overflow-y-auto medos-scroll">
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Back */}
            <button
              onClick={() => setPhase("select")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-5 transition-colors"
            >
              <ChevronLeft className="size-3.5" />
              All scenarios
            </button>

            {/* Header */}
            <div className="relative overflow-hidden bg-card border border-border/60 rounded-xl p-5 md:p-6 mb-5">
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 to-transparent" />
              <div className="flex items-start gap-4">
                <div className="size-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <Stethoscope className="size-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      {isDataInterp ? "Data Interpretation" : "Virtual Patient"}
                    </span>
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", diffClass(activeCase.difficulty))}>
                      {activeCase.difficulty}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold tracking-tight mb-0.5">{activeCase.title}</h2>
                  <p className="text-xs text-muted-foreground">{activeCase.specialty}</p>
                </div>
              </div>
            </div>

            {/* Patient info */}
            {!isDataInterp && (
              <div className="bg-card border border-border/60 rounded-xl p-4 mb-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Patient</p>
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                    {p.name[0]}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.age} years old · {p.gender}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Task */}
            <div className="bg-card border border-border/60 rounded-xl p-4 mb-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Your Task</p>
              <p className="text-sm leading-relaxed">{activeCase.task}</p>
            </div>

            {/* Data (if data-interp) */}
            {isDataInterp && activeCase.dataPresented?.scenario && (
              <div className="bg-card border border-border/60 rounded-xl p-4 mb-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Clinical Scenario</p>
                <p className="text-sm leading-relaxed">{activeCase.dataPresented.scenario}</p>
              </div>
            )}
            {isDataInterp && activeCase.dataPresented?.tables && activeCase.dataPresented.tables.length > 0 && (
              <div className="mb-4">
                <DataTablesRenderer tables={activeCase.dataPresented.tables} />
              </div>
            )}

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { icon: Clock, val: dur + " min", label: "Time limit" },
                { icon: Activity, val: String(MAX_TURNS), label: "Max turns" },
                { icon: BarChart3, val: "AI", label: "Examiner" },
              ].map(({ icon: Icon, val, label }) => (
                <div key={label} className="bg-card border border-border/60 rounded-xl p-3 text-center">
                  <Icon className="size-4 text-primary mx-auto mb-1" />
                  <div className="text-sm font-bold tabular-nums">{val}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {/* Station navigation (if multiple) */}
            {stations.length > 1 && (
              <div className="bg-card border border-border/60 rounded-xl p-4 mb-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-3">
                  Stations ({stations.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {stations.map((s, i) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setActiveIdx(i);
                        setTranscript([]);
                        setResult(null);
                        setTimerRemaining(s.time || EXAM_TIME);
                      }}
                      className={cn(
                        "h-8 px-3 rounded-md text-xs font-medium border transition-colors",
                        i === activeIdx
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "border-border/60 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                      )}
                    >
                      {i + 1}. {s.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={startConsultation}
                className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors active:scale-[0.98]"
              >
                <Play className="size-4" />
                {isDataInterp ? "Begin Exam" : "Enter Consultation Room"}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  /* ── Conversation Phase ─────────────────────────────────────── */

  if (phase === "conversation" && activeCase) {
    const p = activeCase.patient;
    const isDataInterp = activeCase.type === "data-interp";
    const isTimeUp = timerRemaining <= 0;
    const stationDuration = activeCase.time || EXAM_TIME;
    const turnCount = userTurnCount(transcript);
    const timeUsedPct = Math.round(((stationDuration - timerRemaining) / stationDuration) * 100);
    const turnPct = Math.min(100, Math.round((turnCount / Math.max(1, WARN_TURNS)) * 100));
    const momentum = Math.min(100, Math.round(turnPct * 0.7 + Math.min(timeUsedPct, 90) * 0.3));
    const mapStep = (() => {
      if (turnCount < 2) return 0;
      if (turnCount < 7) return 1;
      if (turnCount < 12) return 2;
      if (turnCount < 17) return 3;
      return 4;
    })();
    const speakerName = getSpeakerName(activeCase);

    async function handleSend() {
      const text = inputText.trim();
      if (!text || !activeCase) return;
      if (!hasApiKey()) {
        setError("Configure your Gemini API key in Settings first.");
        return;
      }
      if (userTurnCount(transcript) >= MAX_TURNS) {
        setError(`Maximum ${MAX_TURNS} questions reached. Click Submit for feedback.`);
        return;
      }
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
      } catch (err: unknown) {
        setThinking(false);
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to get response");
      } finally {
        setSending(false);
        if (inputRef.current) inputRef.current.focus();
      }
    }

    async function handleSubmit() {
      if (!hasApiKey()) { setError("Configure your Gemini API key first."); return; }
      if (!transcript.filter((m) => m.role === "user").length) {
        setError("Ask at least one question first.");
        return;
      }
      if (!activeCase) return;
      stopTimer();
      if (abortRef.current) abortRef.current.abort();
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

    function handleReset() {
      stopTimer();
      if (voiceOn) stopSpeaking();
      setTranscript([]);
      setRenderedCount(0);
      setTimerRemaining(activeCase?.time || EXAM_TIME);
      setResult(null);
      setError(null);
      clearSession();
      setPhase("lobby");
      setResetModalOpen(false);
    }

    function insertPrompt(text: string) {
      setInputText(text);
      if (inputRef.current) inputRef.current.focus();
    }

    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center gap-2 px-3 py-2 bg-card/80 border-b border-border/60 shrink-0 backdrop-blur-sm">
          <button
            onClick={() => { stopTimer(); setPhase("lobby"); }}
            className="size-8 rounded-md hover:bg-muted/60 flex items-center justify-center shrink-0 transition-colors"
            title="Back to lobby"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">
              {isDataInterp ? activeCase.examiner?.name || "Examiner" : activeCase.title}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">{activeCase.specialty}</div>
          </div>
          {/* Timer */}
          <div className="flex items-center gap-1 shrink-0 px-2 py-1 rounded-md bg-muted/40 border border-border/60">
            <Clock className="size-3 text-muted-foreground" />
            <span
              className={cn(
                "text-sm font-bold tabular-nums",
                timerState(timerRemaining) === "ok" && "text-emerald-500",
                timerState(timerRemaining) === "warn" && "text-amber-500",
                timerState(timerRemaining) === "danger" && "text-red-500 animate-pulse"
              )}
            >
              {formatTime(timerRemaining)}
            </span>
          </div>
        </header>

        {/* Timer progress bar */}
        <div className="h-0.5 bg-muted/40 shrink-0">
          <div
            className={cn(
              "h-full transition-all duration-1000",
              timerState(timerRemaining) === "ok" && "bg-emerald-500",
              timerState(timerRemaining) === "warn" && "bg-amber-500",
              timerState(timerRemaining) === "danger" && "bg-red-500"
            )}
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
              className="bg-red-500/10 border-b border-red-500/20 text-red-500 text-xs font-medium text-center py-1.5 shrink-0"
            >
              Time expired — submit for examiner feedback
            </motion.div>
          )}
        </AnimatePresence>

        {/* Body */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Sidebar (desktop) */}
          {!isMobile && (
            <aside
              className="bg-card/40 border-r border-border/60 flex flex-col gap-3 p-3 overflow-y-auto shrink-0"
              style={{ width: SIDEBAR_WIDTH }}
            >
              {/* Patient card */}
              <div className="bg-card border border-border/60 rounded-lg p-3">
                <div className="flex items-center gap-2.5">
                  <div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-semibold text-xs shrink-0">
                    {isDataInterp
                      ? (activeCase.examiner?.name?.[0] || "E")
                      : p.name[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">
                      {isDataInterp ? activeCase.examiner?.name || "Examiner" : p.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {isDataInterp
                        ? activeCase.examiner?.title || "Consultant"
                        : `${p.age}y · ${p.gender} · ${activeCase.specialty}`}
                    </div>
                  </div>
                </div>
              </div>

              {/* Progress */}
              <div className="bg-card border border-border/60 rounded-lg p-3 space-y-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Progress</div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Questions</span>
                  <span className="font-semibold tabular-nums">{turnCount} / {MAX_TURNS}</span>
                </div>
                <div className="h-1 bg-border/40 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-500"
                    style={{ width: momentum + "%" }}
                  />
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Time used</span>
                  <span className="font-semibold tabular-nums">{timeUsedPct}%</span>
                </div>
              </div>

              {/* Consultation map */}
              {!isDataInterp && (
                <div className="bg-card border border-border/60 rounded-lg p-3">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Consultation Map</div>
                  <div className="flex flex-col gap-0.5">
                    {MAP_STEPS.map(([label, desc], i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded-md transition-all",
                          i < mapStep && "text-emerald-500",
                          i === mapStep && "text-foreground font-semibold bg-primary/10",
                          i > mapStep && "text-muted-foreground"
                        )}
                      >
                        <div
                          className={cn(
                            "size-1.5 rounded-full shrink-0",
                            i < mapStep ? "bg-emerald-500" : i === mapStep ? "bg-primary" : "bg-border"
                          )}
                        />
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick prompts */}
              {!isDataInterp && (
                <div className="bg-card border border-border/60 rounded-lg p-3">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Quick Prompts</div>
                  <div className="flex flex-col gap-1">
                    {[
                      ["Open", "Can you tell me more about what brought you in today?"],
                      ["Timing", "When did this start, and what were you doing?"],
                      ["Severity", "On a scale of 1-10, how bad is it?"],
                      ["Triggers", "Does anything make it better or worse?"],
                      ["PMH", "Do you have any medical conditions or take regular medicines?"],
                      ["ICE", "Is there anything you are particularly worried this might be?"],
                    ].map(([label, prompt]) => (
                      <button
                        key={label}
                        onClick={() => insertPrompt(prompt)}
                        className="w-full text-left px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={sending || thinking || !transcript.length}
                className="w-full h-9 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Submit for Feedback
              </button>
            </aside>
          )}

          {/* Chat Zone */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Transcript */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 md:px-4 py-4 space-y-4 medos-scroll flex flex-col">
              {transcript.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-12 text-muted-foreground">
                  <Stethoscope className="size-8 opacity-30" />
                  <p className="text-sm font-medium">
                    {isDataInterp
                      ? "The examiner will present the case when you speak."
                      : `Say hello to ${p.name} to begin.`}
                  </p>
                  <p className="text-xs opacity-70">Type a message below or use the microphone.</p>
                </div>
              )}

              {transcript.map((m, i) => {
                const isModel = m.role === "model";
                const label = isDataInterp
                  ? isModel ? activeCase.examiner?.name || "Examiner" : "You"
                  : isModel ? speakerName : "You";
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className={cn(
                      "flex flex-col gap-1 max-w-[80%] md:max-w-[600px]",
                      isModel ? "self-start" : "self-end items-end"
                    )}
                  >
                    <div
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1",
                        isModel ? "text-primary/70" : "text-muted-foreground"
                      )}
                    >
                      {isModel && <Stethoscope className="size-2.5" />}
                      {label}
                    </div>
                    <div
                      className={cn(
                        "px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed",
                        isModel
                          ? "bg-card border border-border/60 text-foreground rounded-tl-sm"
                          : "bg-primary/10 border border-primary/20 text-foreground rounded-tr-sm"
                      )}
                      dangerouslySetInnerHTML={{ __html: md(m.text) }}
                    />
                  </motion.div>
                );
              })}

              {/* Thinking indicator */}
              <AnimatePresence>
                {thinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="self-start flex flex-col gap-1"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-primary/70 flex items-center gap-1">
                      <Stethoscope className="size-2.5" />
                      {isDataInterp ? activeCase.examiner?.name || "Examiner" : speakerName}
                    </div>
                    <div className="bg-card border border-border/60 rounded-2xl rounded-tl-sm px-4 py-2.5 inline-flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="size-1.5 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: "0s" }} />
                        <span className="size-1.5 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: "0.15s" }} />
                        <span className="size-1.5 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: "0.3s" }} />
                      </div>
                      <span className="text-xs text-muted-foreground italic">
                        {isDataInterp ? "evaluating…" : "typing…"}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Interim voice text */}
              {interimText && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="self-end flex flex-col gap-1 items-end max-w-[80%]"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">You</div>
                  <div className="px-3.5 py-2.5 rounded-2xl rounded-tr-sm bg-primary/5 border border-primary/10 text-sm text-muted-foreground italic">
                    {interimText}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mx-3 mb-1"
                >
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                    <AlertCircle className="size-3.5 shrink-0" />
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input area */}
            <div className="border-t border-border/60 bg-card/80 shrink-0 p-3">
              {/* Voice status */}
              {voiceOn && (
                <div className="flex items-center gap-2 mb-2 px-1">
                  <div
                    className={cn(
                      "size-1.5 rounded-full",
                      voicePhase === "speaking" ? "bg-sky-500 animate-pulse" :
                      voicePhase === "listening" ? "bg-red-500 animate-pulse" :
                      "bg-muted-foreground"
                    )}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {voicePhase === "speaking" ? "Speaking…" :
                     voicePhase === "listening" ? "Listening…" :
                     "Voice ready"}
                  </span>
                </div>
              )}

              {/* Input row */}
              <div className="flex items-end gap-2">
                <button
                  onClick={toggleVoice}
                  className={cn(
                    "size-10 rounded-lg border flex items-center justify-center shrink-0 transition-all",
                    voiceOn
                      ? "bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20"
                      : "border-border/60 bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5"
                  )}
                  title={voiceOn ? "Disable voice" : "Enable voice"}
                >
                  {voiceOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
                </button>

                <textarea
                  ref={inputRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={isDataInterp ? "Answer the examiner's question…" : "Ask the patient a question…"}
                  rows={1}
                  className="flex-1 resize-none min-h-[40px] max-h-[120px] px-3 py-2 rounded-lg border border-border/60 bg-background text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
                  style={{ height: "auto", minHeight: "40px" }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = Math.min(120, el.scrollHeight) + "px";
                  }}
                />

                <button
                  onClick={handleSend}
                  disabled={sending || !inputText.trim()}
                  className="h-10 px-4 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 shrink-0 flex items-center gap-1.5"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <><Send className="size-3.5" />Send</>}
                </button>
              </div>

              {/* Bottom bar */}
              <div className="flex items-center gap-2 mt-2">
                <span
                  className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full border tabular-nums",
                    turnCount >= WARN_TURNS
                      ? "border-red-500/30 text-red-500 bg-red-500/10"
                      : turnCount >= Math.floor(WARN_TURNS * 0.7)
                      ? "border-amber-500/30 text-amber-500 bg-amber-500/10"
                      : "border-border/60 text-muted-foreground"
                  )}
                >
                  {turnCount}/{MAX_TURNS}
                </span>

                {isMobile && (
                  <button
                    onClick={handleSubmit}
                    disabled={sending || thinking || !transcript.length}
                    className="flex-1 h-7 px-3 rounded-md border border-border/60 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Submit for Feedback
                  </button>
                )}

                <div className="ml-auto flex items-center gap-1">
                  {!isMobile && (
                    <button
                      onClick={handleSubmit}
                      disabled={sending || thinking || !transcript.length}
                      className="h-7 px-3 rounded-md border border-border/60 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Submit for Feedback
                    </button>
                  )}
                  <button
                    onClick={() => setResetModalOpen(true)}
                    className="h-7 px-2.5 rounded-md border border-border/60 text-[11px] text-muted-foreground hover:border-red-500/40 hover:text-red-500 transition-colors flex items-center gap-1"
                  >
                    <RotateCcw className="size-3" />
                    Reset
                  </button>
                </div>
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
              className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
              onClick={() => setResetModalOpen(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 12 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                className="bg-card border border-border/60 rounded-xl p-6 max-w-sm w-full shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-base font-semibold mb-1">Reset Consultation?</h3>
                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                  This will clear the entire conversation, timer, and progress. This cannot be undone.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setResetModalOpen(false)}
                    className="h-9 px-4 rounded-lg border border-border/60 text-sm font-medium hover:bg-muted/60 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      stopTimer();
                      if (voiceOn) stopSpeaking();
                      setTranscript([]);
                      setRenderedCount(0);
                      setTimerRemaining(activeCase?.time || EXAM_TIME);
                      setResult(null);
                      setError(null);
                      clearSession();
                      setPhase("lobby");
                      setResetModalOpen(false);
                    }}
                    className="h-9 px-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/20 transition-colors"
                  >
                    Reset
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  /* ── Debrief Phase ──────────────────────────────────────────── */

  if (phase === "debrief" && result && activeCase) {
    const isDataInterp = activeCase.type === "data-interp";
    const stationDuration = activeCase.time || EXAM_TIME;
    const turnCount = userTurnCount(transcript);
    const timeUsedPct = Math.round(((stationDuration - timerRemaining) / stationDuration) * 100);
    const hp = activeCase.hiddenProfile;
    const band =
      result.score >= 90 ? "Outstanding" :
      result.score >= 75 ? "Strong pass" :
      result.score >= 60 ? "Clear pass" :
      result.score >= 40 ? "Needs improvement" :
      "Restart recommended";

    const domainDefs = isDataInterp
      ? [
          { k: "knowledge", l: "Knowledge", m: 30 },
          { k: "interpretation", l: "Interpretation", m: 30 },
          { k: "reasoning", l: "Reasoning", m: 25 },
          { k: "communication", l: "Communication", m: 15 },
        ]
      : [
          { k: "communication", l: "Communication", m: 25 },
          { k: "infoGathering", l: "Info Gathering", m: 25 },
          { k: "clinicalReasoning", l: "Clinical Reasoning", m: 25 },
          { k: "professionalism", l: "Professionalism", m: 25 },
        ];

    const badges = buildAchievements(result, timeUsedPct, turnCount);

    return (
      <div className="fixed inset-0 z-50 bg-background overflow-y-auto medos-scroll">
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {/* Back */}
            <button
              onClick={() => { setResult(null); setPhase("conversation"); }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="size-3.5" />
              Back to consultation
            </button>

            {/* Score banner */}
            <div className="relative overflow-hidden bg-card border border-border/60 rounded-xl p-5 md:p-6">
              <div
                className="absolute top-0 left-0 right-0 h-0.5"
                style={{
                  background: `linear-gradient(90deg, ${
                    result.score >= 75 ? "oklch(0.65 0.18 145)" :
                    result.score >= 50 ? "oklch(0.78 0.16 80)" :
                    "oklch(0.68 0.21 22)"
                  }, transparent)`,
                }}
              />
              <div className="flex items-center gap-5 flex-wrap">
                <div className="size-20 rounded-full border-2 border-primary/30 bg-primary/10 flex flex-col items-center justify-center shrink-0">
                  <div className="text-2xl font-bold text-primary leading-none">{result.score}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">/ 100</div>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-lg font-bold mb-1">{band}</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn(
                      "text-xs font-semibold px-2 py-0.5 rounded-full border",
                      result.passed
                        ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10"
                        : "border-red-500/30 text-red-500 bg-red-500/10"
                    )}>
                      {result.passed ? "Passed" : "Not Passed"}
                    </span>
                    <span className="text-xs text-muted-foreground">{turnCount} turns · {timeUsedPct}% time used</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { val: timeUsedPct + "%", label: "Time Used", color: "text-emerald-500" },
                { val: String(turnCount), label: "Turns", color: "text-primary" },
                { val: String(result.asked.length), label: "Covered", color: "text-emerald-500" },
                { val: String(result.missed.length), label: "Missed", color: "text-red-500" },
              ].map((s) => (
                <div key={s.label} className="bg-card border border-border/60 rounded-xl p-3 text-center">
                  <div className={cn("text-base font-bold tabular-nums", s.color)}>{s.val}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Domain scores */}
            <div className="bg-card border border-border/60 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-3 flex items-center gap-1.5">
                <Activity className="size-3" /> Domain Scores
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {domainDefs.map((dd) => {
                  const v = result.domains[dd.k] || 0;
                  const pct = (v / dd.m) * 100;
                  const q = pct >= 70 ? "good" : pct >= 40 ? "avg" : "low";
                  return (
                    <div key={dd.k}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{dd.l}</span>
                        <span className={cn(
                          "text-xs font-bold tabular-nums",
                          q === "good" && "text-emerald-500",
                          q === "avg" && "text-amber-500",
                          q === "low" && "text-red-500"
                        )}>
                          {v}/{dd.m}
                        </span>
                      </div>
                      <div className="h-1.5 bg-border/40 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            q === "good" && "bg-emerald-500",
                            q === "avg" && "bg-amber-500",
                            q === "low" && "bg-red-500"
                          )}
                          style={{ width: pct + "%" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Feedback */}
            <div className="bg-card border border-border/60 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2 flex items-center gap-1.5">
                <Lightbulb className="size-3" /> Examiner Feedback
              </p>
              <p className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: md(result.feedback) }} />
              {hp.diagnosis && (
                <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs">
                  <Stethoscope className="size-3.5 text-primary shrink-0 mt-0.5" />
                  <span><strong className="text-primary">Hidden diagnosis:</strong> {hp.diagnosis}</span>
                </div>
              )}
            </div>

            {/* Criteria review */}
            <div className="bg-card border border-border/60 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-3 flex items-center gap-1.5">
                <AlignLeft className="size-3" /> Criteria Review
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-emerald-500 mb-2">
                    Covered ({result.asked.length})
                  </h4>
                  <div className="space-y-1">
                    {(result.asked.length ? result.asked : ["(none matched)"]).map((x, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs px-2 py-1.5 rounded-md bg-emerald-500/8 border border-emerald-500/20 text-emerald-500">
                        <Check className="size-3 mt-0.5 shrink-0" /> {x}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-red-500 mb-2">
                    Missed ({result.missed.length})
                  </h4>
                  <div className="space-y-1">
                    {(result.missed.length ? result.missed : ["(nothing missed — excellent!)"]).map((x, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs px-2 py-1.5 rounded-md bg-red-500/8 border border-red-500/20 text-red-500">
                        <X className="size-3 mt-0.5 shrink-0" /> {x}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Achievements */}
            {badges.length > 0 && (
              <div className="bg-card border border-border/60 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-3">
                  Achievements
                </p>
                <div className="flex flex-wrap gap-2">
                  {badges.map((b, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border",
                        b.color === "gold" && "border-amber-500/30 bg-amber-500/10 text-amber-500",
                        b.color === "green" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
                        b.color === "blue" && "border-sky-500/30 bg-sky-500/10 text-sky-500",
                        b.color === "purple" && "border-purple-500/30 bg-purple-500/10 text-purple-500"
                      )}
                    >
                      <span>{b.icon}</span>
                      <span>{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => {
                  stopTimer();
                  setResult(null);
                  setPhase("conversation");
                }}
                className="h-10 px-4 rounded-lg border border-border/60 text-sm font-medium hover:bg-muted/60 transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="size-3.5" /> Back to Consultation
              </button>
              <button
                onClick={() => {
                  stopTimer();
                  setTranscript([]);
                  setRenderedCount(0);
                  setTimerRemaining(activeCase?.time || EXAM_TIME);
                  setResult(null);
                  setError(null);
                  clearSession();
                  setPhase("lobby");
                }}
                className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2 active:scale-[0.98]"
              >
                <RefreshCw className="size-3.5" /> Try Again
              </button>
              <button
                onClick={() => setPhase("select")}
                className="h-10 px-4 rounded-lg border border-border/60 text-sm font-medium hover:bg-muted/60 transition-colors flex items-center gap-2"
              >
                <Home className="size-3.5" /> All Scenarios
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  /* Fallback loading */
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/* ── Data Tables Renderer ─────────────────────────────────────────── */

function DataTablesRenderer({ tables }: { tables?: OsceDataTable[] }) {
  const [open, setOpen] = React.useState(false);
  if (!tables || !tables.length) return null;
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card text-xs font-medium flex items-center justify-between hover:border-primary/40 transition-colors"
      >
        Lab Data <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {tables.map((t, i) => (
            <div key={i} className="bg-muted/20 border border-border/60 rounded-lg p-3 overflow-x-auto">
              {t.title && (
                <div className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1.5">{t.title}</div>
              )}
              <table className="w-full text-[11px]">
                {t.headers && t.headers.length > 0 && (
                  <thead>
                    <tr>
                      {t.headers.map((h, hi) => (
                        <th key={hi} className="text-left px-2 py-1 font-bold text-muted-foreground border-b border-border/40 text-[9px] uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {(t.rows || []).map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td key={ci} className={cn("px-2 py-1 border-b border-border/20", ci === r.length - 1 ? "font-medium" : "text-muted-foreground")}>
                          {c}
                        </td>
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
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card text-xs font-medium flex items-center justify-between hover:border-primary/40 transition-colors"
      >
        Clinical Images ({images.length})
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {images.map((im, i) => {
            const src = im.src || im.url || "";
            if (!src) return null;
            return (
              <div key={i} className="bg-muted/20 border border-border/60 rounded-lg overflow-hidden">
                {im.title && (
                  <div className="text-[10px] font-bold text-primary uppercase tracking-wider px-3 pt-3">{im.title}</div>
                )}
                <img src={src} alt={im.alt || im.caption || ""} className="w-full max-h-80 object-contain" loading="lazy" />
                {im.caption && (
                  <div className="text-[10px] text-muted-foreground px-3 pb-3 pt-1">{im.caption}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
