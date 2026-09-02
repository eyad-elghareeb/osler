/**
 * MCP exam-PDF structure detection — pure text heuristics, no dependencies.
 *
 * Converts extracted PDF text into draft Osler bodies:
 *  - parseMcqText  → { questions } (quiz schema: stem, A-E options, 0-indexed
 *    correct, explanation) with answers resolved from inline "Answer: B"
 *    lines or a trailing answer-key table.
 *  - parseWrittenText → { prompts } (written schema: prompt, sampleAnswer,
 *    point-allocated rubric) from numbered questions, marks annotations, and
 *    marking-scheme sections.
 *
 * These are best-effort: exam PDFs are wildly inconsistent, so every parser
 * returns `warnings` describing what it skipped or guessed, and items the
 * agent must review (e.g. missing answers) are emitted without the field the
 * schema requires — validate_content catches them if uploaded unreviewed.
 */

// ─── Shared line patterns ────────────────────────────────────────────────────

/** "1." "2)" "Q3:" "Question 12 -" */
const Q_START = /^\s*(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[.)\]:\-]\s*(.*)$/i;
/** "A. text" "(B) text" "c) text" */
const OPTION_LINE = /^\s*\(?([A-Ea-e])\s*[).]\s+(.+)$/;
/** "Answer: B" "Ans - C" "Correct answer is D" (line-initial only) */
const INLINE_ANS = /^\s*(?:the\s+)?(?:correct\s+)?ans(?:wer)?\s*(?:is)?\s*[:.\-]\s*\(?([A-Ea-e])\s*\)?\s*[.:\-—]?\s*(.*)$/i;
/** "Explanation: …" "Rationale …" */
const EXPL_START = /^\s*(?:explanation|rationale|discussion|commentary|comments?)\s*[:.\-]?\s*(.*)$/i;
/** "Answer Key" / "Answers:" section headers */
const KEY_HEADER = /^\s*(?:answer\s*key|answers)\s*[:.]?\s*$/i;
/** "1-B" "2. D" "(3) A" pairs; also found several-per-line */
const KEY_PAIR = /(\d{1,3})\s*[.\-)]\s*\(?([A-Ea-e])\)?(?![a-zA-Z])/g;
const PAGE_MARKER = /^\s*(?:\f)?=== Page \d+ ===\s*$/;

const collapse = (lines: string[]): string => lines.join(" ").replace(/\s+/g, " ").trim();
const letterIndex = (letter: string): number => letter.toUpperCase().charCodeAt(0) - 65;

// ─── MCQ ─────────────────────────────────────────────────────────────────────

export interface DraftMcq {
  id: string;
  question: string;
  options: string[];
  /** 0-indexed; omitted when no answer was found — the agent must supply it. */
  correct?: number;
  explanation?: string;
}

export interface McqParseResult {
  questions: DraftMcq[];
  warnings: string[];
  stats: { blocks: number; withOptions: number; inlineAnswers: number; keyTableAnswers: number; missingAnswers: number };
}

interface McqBlock {
  num: number;
  stem: string[];
  options: { letter: string; text: string[] }[];
  option: { letter: string; text: string[] } | null;
  inlineAnswer: string | null;
  explanation: string[];
  inExplanation: boolean;
}

export function parseMcqText(pages: string[]): McqParseResult {
  const warnings: string[] = [];
  const stats = { blocks: 0, withOptions: 0, inlineAnswers: 0, keyTableAnswers: 0, missingAnswers: 0 };
  const blocks: McqBlock[] = [];
  const keyMap = new Map<number, string>();
  let current: McqBlock | null = null;
  let inKeySection = false;

  for (const raw of pages.flatMap((p) => p.split(/\r?\n/))) {
    if (!raw.trim() || PAGE_MARKER.test(raw)) continue;

    // Trailing answer-key table: consume pairs until a real question starts.
    if (inKeySection) {
      const qMatch = raw.match(Q_START);
      if (qMatch && !/^\s*[.\-)\s\dA-Ea-e(]+$/.test(raw)) {
        inKeySection = false; // falls through to normal handling below
      } else {
        for (const [, num, letter] of raw.matchAll(KEY_PAIR)) keyMap.set(Number(num), letter.toUpperCase());
        continue;
      }
    }

    const keyHeader = raw.match(KEY_HEADER);
    if (keyHeader) {
      inKeySection = true;
      continue;
    }

    const qMatch = raw.match(Q_START);
    const stemIsBareLetter = qMatch && /^[A-Ea-e]\s*$/.test(qMatch[2]);
    if (qMatch && !stemIsBareLetter) {
      const num = Number(qMatch[1]);
      const startsNew = !current || num !== current.num || current.options.length >= 2;
      if (startsNew) {
        current = { num, stem: [qMatch[2]].filter(Boolean), options: [], option: null, inlineAnswer: null, explanation: [], inExplanation: false };
        blocks.push(current);
      } else if (current) {
        // Numbered line that continues the current question (e.g. a wrapped
        // reference) — route into whichever mode we were in.
        appendToMode(current, raw.trim());
      }
      continue;
    }

    const optMatch = raw.match(OPTION_LINE);
    if (optMatch && current) {
      const letter = optMatch[1].toUpperCase();
      current.option = { letter, text: [optMatch[2]] };
      current.options.push(current.option);
      current.inExplanation = false;
      continue;
    }

    const ansMatch = raw.match(INLINE_ANS);
    if (ansMatch && current) {
      current.inlineAnswer = ansMatch[1].toUpperCase();
      if (ansMatch[2].trim()) current.explanation.push(ansMatch[2].trim());
      current.inExplanation = current.explanation.length > 0;
      continue;
    }

    const explMatch = raw.match(EXPL_START);
    if (explMatch && current) {
      current.inExplanation = true;
      if (explMatch[1].trim()) current.explanation.push(explMatch[1].trim());
      continue;
    }

    if (current) appendToMode(current, raw.trim());
  }

  const questions: DraftMcq[] = [];
  for (const block of blocks) {
    stats.blocks++;
    if (block.options.length < 2) {
      if (block.stem.length) warnings.push(`Skipped block "${block.num}" — ${block.options.length < 1 ? "no options detected" : "only one option detected"}.`);
      continue;
    }
    stats.withOptions++;
    const byLetter = new Map<string, string[]>();
    for (const opt of block.options) {
      const prev = byLetter.get(opt.letter);
      byLetter.set(opt.letter, prev ? [...prev, ...opt.text] : opt.text);
    }
    const letters = [...byLetter.keys()].sort();
    if (byLetter.size !== block.options.length) warnings.push(`Question ${block.num}: duplicate option letters were merged — verify the options list.`);
    const question: DraftMcq = { id: `q${block.num}`, question: collapse(block.stem), options: letters.map((l) => collapse(byLetter.get(l)!)) };
    if (question.question.length < 5) warnings.push(`Question ${block.num}: stem looks empty — fill it in before upload.`);

    const letter = block.inlineAnswer ?? keyMap.get(block.num) ?? null;
    if (letter) {
      const idx = letterIndex(letter);
      if (idx < question.options.length) {
        question.correct = idx;
        if (block.inlineAnswer) stats.inlineAnswers++;
        else stats.keyTableAnswers++;
      } else {
        warnings.push(`Question ${block.num}: answer key says "${letter}" but only ${question.options.length} options were found.`);
        stats.missingAnswers++;
      }
    } else {
      warnings.push(`Question ${block.num}: no answer found (no inline "Answer:" line and no key-table entry) — set "correct" before upload.`);
      stats.missingAnswers++;
    }
    const explanation = collapse(block.explanation);
    if (explanation) question.explanation = explanation;
    questions.push(question);
  }
  if (!blocks.length) warnings.push("No numbered question blocks detected — the PDF may be scanned (image-only) or use an unrecognized layout. Fall back to parse_pdf and author manually.");
  return { questions, warnings, stats };
}

function appendToMode(block: McqBlock, line: string) {
  if (block.inExplanation) block.explanation.push(line);
  else if (block.option) block.option.text.push(line);
  else block.stem.push(line);
}

// ─── Written prompts ─────────────────────────────────────────────────────────

export interface DraftRubricItem {
  id: string;
  criterion: string;
  maxPoints: number;
}

export interface DraftWrittenPrompt {
  id: string;
  prompt: string;
  sampleAnswer?: string;
  rubric?: DraftRubricItem[];
}

export interface WrittenParseResult {
  prompts: DraftWrittenPrompt[];
  warnings: string[];
  stats: { blocks: number; withMarks: number; withRubric: number; withModelAnswer: number };
}

const MARKS_TOKEN = /[([]\s*(\d{1,3})\s*(?:marks?|mk|pts?|points)\s*[)\]]/gi;
const MODEL_START = /^\s*(?:model\s+answers?|sample\s+answers?|suggested\s+answers?)\s*[:.\-]?\s*(.*)$/i;
const RUBRIC_START = /^\s*(?:marking\s+(?:scheme|guide|key)|rubric|mark\s+allocation|allocation\s+of\s+marks)\s*[:.\-]?\s*(.*)$/i;
const RUBRIC_BULLET = /^\s*[•*\-]\s+(.+)$/;
const DEFAULT_MAX_POINTS = 10;

interface WrittenBlock {
  num: number;
  prompt: string[];
  marks: number | null;
  model: string[];
  rubric: DraftRubricItem[];
  mode: "prompt" | "model" | "rubric";
}

export function parseWrittenText(pages: string[]): WrittenParseResult {
  const warnings: string[] = [];
  const stats = { blocks: 0, withMarks: 0, withRubric: 0, withModelAnswer: 0 };
  const blocks: WrittenBlock[] = [];
  let current: WrittenBlock | null = null;

  for (const raw of pages.flatMap((p) => p.split(/\r?\n/))) {
    if (!raw.trim() || PAGE_MARKER.test(raw)) continue;

    const qMatch = raw.match(Q_START);
    if (qMatch && qMatch[2].trim()) {
      const marksMatch = [...raw.matchAll(MARKS_TOKEN)];
      const marks = marksMatch.length ? Number(marksMatch[marksMatch.length - 1][1]) : null;
      const text = qMatch[2].replace(MARKS_TOKEN, " ").replace(/\s+/g, " ").trim();
      if (current && Number(qMatch[1]) === current.num && !current.prompt.join("").length) {
        current.prompt.push(text);
        continue;
      }
      current = { num: Number(qMatch[1]), prompt: [text], marks, model: [], rubric: [], mode: "prompt" };
      blocks.push(current);
      continue;
    }

    const modelMatch = raw.match(MODEL_START);
    if (modelMatch && current) {
      current.mode = "model";
      if (modelMatch[1].trim()) current.model.push(modelMatch[1].trim());
      continue;
    }

    const rubricMatch = raw.match(RUBRIC_START);
    if (rubricMatch && current) {
      current.mode = "rubric";
      const inline = rubricMatch[1].trim();
      if (inline) addRubricLine(current, inline);
      continue;
    }

    if (!current) continue;

    if (current.mode === "rubric") {
      const bullet = raw.match(RUBRIC_BULLET);
      const numbered = raw.match(Q_START);
      if (bullet) addRubricLine(current, bullet[1]);
      else if (numbered) addRubricLine(current, numbered[2]);
      else if (/[[(]\s*\d+\s*(?:marks?|pts?|points)/i.test(raw)) addRubricLine(current, raw.trim());
      else current.model.push(raw.trim()); // rubric section ended — treat as model answer overflow
      continue;
    }

    const mode = current.mode;
    if (mode === "prompt") {
      const marksInline = [...raw.matchAll(MARKS_TOKEN)];
      if (marksInline.length && !current.marks) current.marks = Number(marksInline[marksInline.length - 1][1]);
      current.prompt.push(raw.replace(MARKS_TOKEN, " ").replace(/\s+/g, " ").trim());
    } else {
      current.model.push(raw.trim());
    }
  }

  const prompts: DraftWrittenPrompt[] = [];
  for (const block of blocks) {
    stats.blocks++;
    const prompt = collapse(block.prompt);
    if (prompt.length < 5) {
      warnings.push(`Skipped block ${block.num} — prompt text looks empty.`);
      continue;
    }
    const item: DraftWrittenPrompt = { id: `wp${block.num}`, prompt };
    if (block.model.length) {
      item.sampleAnswer = block.model.join("\n").trim();
      stats.withModelAnswer++;
    }
    if (block.rubric.length >= 2) {
      item.rubric = block.rubric;
      stats.withRubric++;
    } else if (block.rubric.length === 1) {
      item.rubric = block.rubric;
      stats.withRubric++;
      warnings.push(`Prompt ${block.num}: only one rubric criterion detected — consider splitting it into graded parts.`);
    } else if (block.marks != null) {
      item.rubric = [{ id: `${item.id}r1`, criterion: "Provides a complete, accurate answer", maxPoints: block.marks }];
    } else {
      item.rubric = [{ id: `${item.id}r1`, criterion: "Provides a complete, accurate answer", maxPoints: DEFAULT_MAX_POINTS }];
      warnings.push(`Prompt ${block.num}: no marks annotation found — rubric defaults to ${DEFAULT_MAX_POINTS} points.`);
    }
    if (block.marks != null) stats.withMarks++;
    prompts.push(item);
  }
  if (!blocks.length) warnings.push("No numbered written prompts detected — the PDF may be scanned (image-only) or use an unrecognized layout. Fall back to parse_pdf and author manually.");
  return { prompts, warnings, stats };
}

function addRubricLine(block: WrittenBlock, line: string) {
  const trimmed = line.replace(/\s+/g, " ").trim();
  if (!trimmed) return;
  const pts = [...trimmed.matchAll(MARKS_TOKEN)];
  const maxPoints = pts.length ? Number(pts[pts.length - 1][1]) : 1;
  const criterion = trimmed.replace(MARKS_TOKEN, " ").replace(/[.,;]\s*$/, "").trim();
  block.rubric.push({ id: `wp${block.num}r${block.rubric.length + 1}`, criterion: criterion || "Answer component", maxPoints });
}
