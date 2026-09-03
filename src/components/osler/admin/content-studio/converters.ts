"use client";

/**
 * Content-type converters for the Admin Content Studio.
 *
 * Pure, synchronous functions — no React, no network. Each converter takes
 * the current body (string) plus the current content type, and returns the
 * new body + new content type. Callers are responsible for persisting the
 * result (adminApi.createContent + adminApi.saveDraft, or adminApi.uploadFile
 * for raw R2 keys).
 *
 * Supported conversions:
 *
 *   quiz/bank/written ↔ mixed — mixed keeps both halves; splitting drops one.
 *   quiz    ↔ bank     — both use the `passages` shape; trivially swappable.
 *   quiz/bank → flashcard — one card per question (front=stem, back=explanation).
 *   flashcard → quiz    — one open-ended question per card (no choices).
 *   library  → flashcard — splits markdown on `## ` headings, one card per section.
 *   library  → quiz      — each heading becomes a stem, body becomes explanation.
 *   written  → library/flashcard — one section/card per prompt.
 *   osce/video → library — render as a markdown study sheet.
 *
 * Conversions are lossy by design — they preserve as much signal as possible
 * but never invent answers. The output is always a valid (parseable) body
 * for the target type so the structured editor can open it without errors.
 */

import type { ContentType } from "@/components/osler/admin/admin-api";

export interface ConvertResult {
  contentType: ContentType;
  body: string;
  /** Human-readable summary of what the converter did, shown in the dialog. */
  summary: string;
  /** Items produced (e.g. "12 cards", "5 questions"). */
  itemCount?: number;
}

export interface ConvertOption {
  target: ContentType;
  label: string;
  description: string;
  /** Whether the conversion is lossless (true) or lossy (false). */
  lossless: boolean;
}

/** Returns the list of target types available for a given source type. */
export function convertOptionsFrom(from: ContentType): ConvertOption[] {
  const opts: ConvertOption[] = [];
  switch (from) {
    case "quiz":
      opts.push({ target: "bank", label: "Bank", description: "Wrap questions into a single passage-bank (lossless).", lossless: true });
      opts.push({ target: "mixed", label: "Mixed pack", description: "Keep questions, add an empty written-prompts section.", lossless: true });
      opts.push({ target: "flashcard", label: "Flashcards", description: "One card per question: front = stem, back = explanation.", lossless: false });
      opts.push({ target: "library", label: "Library article", description: "Render questions as a markdown study sheet.", lossless: false });
      break;
    case "bank":
      opts.push({ target: "quiz", label: "Quiz", description: "Flatten passages into a flat question list (lossless).", lossless: true });
      opts.push({ target: "mixed", label: "Mixed pack", description: "Keep passages, add an empty written-prompts section.", lossless: true });
      opts.push({ target: "flashcard", label: "Flashcards", description: "One card per question across all passages.", lossless: false });
      opts.push({ target: "library", label: "Library article", description: "Render passages as a markdown study sheet.", lossless: false });
      break;
    case "flashcard":
      opts.push({ target: "quiz", label: "Quiz", description: "One open-ended question per card (no choices).", lossless: false });
      opts.push({ target: "library", label: "Library article", description: "Render cards as a markdown Q&A sheet.", lossless: false });
      break;
    case "library":
      opts.push({ target: "flashcard", label: "Flashcards", description: "Split markdown on `## ` headings — one card per section.", lossless: false });
      opts.push({ target: "quiz", label: "Quiz", description: "Each `## ` heading becomes a stem; body becomes the explanation.", lossless: false });
      break;
    case "written":
      opts.push({ target: "mixed", label: "Mixed pack", description: "Keep prompts, add an empty MCQ section.", lossless: true });
      opts.push({ target: "library", label: "Library article", description: "Render prompts as a markdown study sheet.", lossless: false });
      opts.push({ target: "flashcard", label: "Flashcards", description: "One card per prompt: front = prompt, back = model answer.", lossless: false });
      break;
    case "mixed":
      opts.push({ target: "quiz", label: "Quiz", description: "Keep the MCQ half (questions + flattened passages); drop prompts.", lossless: false });
      opts.push({ target: "bank", label: "Bank", description: "Keep passages (or wrap questions); drop prompts.", lossless: false });
      opts.push({ target: "written", label: "Written", description: "Keep the prompts half; drop MCQ content.", lossless: false });
      opts.push({ target: "library", label: "Library article", description: "Render both halves as a markdown study sheet.", lossless: false });
      break;
    case "osce":
      opts.push({ target: "library", label: "Library article", description: "Render stations as a markdown study sheet.", lossless: false });
      break;
    case "video":
      opts.push({ target: "library", label: "Library article", description: "Render video list as a markdown link sheet.", lossless: false });
      break;
  }
  return opts;
}

/** Run a conversion. Throws on unsupported pairs (caller should use
 *  `convertOptionsFrom` to filter the dropdown). */
export function convertContent(
  from: ContentType,
  to: ContentType,
  body: string,
): ConvertResult {
  const parsed = safeParse(body);

  switch (from) {
    case "quiz":
      return convertFromQuiz(to, parsed);
    case "bank":
      return convertFromBank(to, parsed);
    case "flashcard":
      return convertFromFlashcard(to, parsed);
    case "library":
      return convertFromLibrary(to, body);
    case "written":
      return convertFromWritten(to, parsed);
    case "mixed":
      return convertFromMixed(to, parsed);
    case "osce":
      return convertFromOsce(to, parsed);
    case "video":
      return convertFromVideo(to, parsed);
  }
  throw new Error(`Unsupported conversion from: ${from}`);
}

// ── Per-source converters ───────────────────────────────────────────────────

function convertFromQuiz(to: ContentType, parsed: any): ConvertResult {
  if (to === "bank") {
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const out = { passages: [{ id: "p-1", content: "", questions }] };
    return {
      contentType: "bank",
      body: JSON.stringify(out, null, 2),
      summary: `Wrapped ${questions.length} question(s) into one passage-bank.`,
      itemCount: questions.length,
    };
  }
  if (to === "flashcard") {
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const cards = questions.map((q: any, i: number) => ({
      id: `c-${i + 1}`,
      front: q.question ?? q.stem ?? "",
      back: q.explanation ?? "",
      tags: q.tags ?? [],
    }));
    return {
      contentType: "flashcard",
      body: JSON.stringify({ cards }, null, 2),
      summary: `Generated ${cards.length} card(s) from question stems + explanations.`,
      itemCount: cards.length,
    };
  }
  if (to === "library") {
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const md = questions.map((q: any, i: number) =>
      `## Q${i + 1}. ${stripMd(q.question ?? q.stem ?? "")}\n\n${stripMd(q.explanation ?? "")}\n`,
    ).join("\n");
    return {
      contentType: "library",
      body: `# Converted Quiz\n\n${md}`,
      summary: `Rendered ${questions.length} question(s) as a markdown study sheet.`,
      itemCount: questions.length,
    };
  }
  if (to === "mixed") {
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const out = { ...parsed, type: "mixed", prompts: [] as any[] };
    return {
      contentType: "mixed",
      body: JSON.stringify(out, null, 2),
      summary: `Kept ${questions.length} question(s); add written prompts in the Mixed editor.`,
      itemCount: questions.length,
    };
  }
  throw new Error(`Unsupported conversion: quiz → ${to}`);
}

function convertFromBank(to: ContentType, parsed: any): ConvertResult {
  const passages = Array.isArray(parsed?.passages) ? parsed.passages : [];
  const allQuestions = passages.flatMap((p: any) => Array.isArray(p.questions) ? p.questions : []);

  if (to === "quiz") {
    return {
      contentType: "quiz",
      body: JSON.stringify({ questions: allQuestions }, null, 2),
      summary: `Flattened ${passages.length} passage(s) into ${allQuestions.length} question(s).`,
      itemCount: allQuestions.length,
    };
  }
  if (to === "flashcard") {
    const cards = allQuestions.map((q: any, i: number) => ({
      id: `c-${i + 1}`,
      front: q.question ?? q.stem ?? "",
      back: q.explanation ?? "",
      tags: q.tags ?? [],
    }));
    return {
      contentType: "flashcard",
      body: JSON.stringify({ cards }, null, 2),
      summary: `Generated ${cards.length} card(s) from ${passages.length} passage(s).`,
      itemCount: cards.length,
    };
  }
  if (to === "library") {
    const md = passages.map((p: any, i: number) => {
      const head = `## Passage ${i + 1}${p.content ? `\n\n${stripMd(p.content)}` : ""}`;
      const qs = (Array.isArray(p.questions) ? p.questions : []).map((q: any, j: number) =>
        `### Q${j + 1}. ${stripMd(q.question ?? q.stem ?? "")}\n\n${stripMd(q.explanation ?? "")}\n`,
      ).join("\n");
      return `${head}\n\n${qs}`;
    }).join("\n");
    return {
      contentType: "library",
      body: `# Converted Passage Bank\n\n${md}`,
      summary: `Rendered ${passages.length} passage(s) as a markdown study sheet.`,
      itemCount: passages.length,
    };
  }
  if (to === "mixed") {
    const out = { ...parsed, type: "mixed", prompts: [] as any[] };
    return {
      contentType: "mixed",
      body: JSON.stringify(out, null, 2),
      summary: `Kept ${passages.length} passage(s); add written prompts in the Mixed editor.`,
      itemCount: passages.length,
    };
  }
  throw new Error(`Unsupported conversion: bank → ${to}`);
}

function convertFromFlashcard(to: ContentType, parsed: any): ConvertResult {
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
  if (to === "quiz") {
    const questions = cards.map((c: any, i: number) => ({
      id: `q-${i + 1}`,
      question: c.front ?? "",
      options: ["", "", "", ""],
      correct: 0,
      explanation: c.back ?? "",
      tags: c.tags ?? [],
      difficulty: 2,
    }));
    return {
      contentType: "quiz",
      body: JSON.stringify({ questions }, null, 2),
      summary: `Generated ${questions.length} open-ended question(s) from cards.`,
      itemCount: questions.length,
    };
  }
  if (to === "library") {
    const md = cards.map((c: any, i: number) =>
      `## ${stripMd(c.front ?? `Card ${i + 1}`)}\n\n${stripMd(c.back ?? "")}\n`,
    ).join("\n");
    return {
      contentType: "library",
      body: `# Converted Flashcards\n\n${md}`,
      summary: `Rendered ${cards.length} card(s) as a markdown study sheet.`,
      itemCount: cards.length,
    };
  }
  throw new Error(`Unsupported conversion: flashcard → ${to}`);
}

function convertFromLibrary(to: ContentType, raw: string): ConvertResult {
  if (to === "flashcard") {
    const sections = splitMarkdownByHeading(raw);
    const cards = sections.map((s, i) => ({
      id: `c-${i + 1}`,
      front: s.heading || `Section ${i + 1}`,
      back: s.body.trim(),
      tags: [],
    })).filter((c) => c.front || c.back);
    return {
      contentType: "flashcard",
      body: JSON.stringify({ cards }, null, 2),
      summary: `Split ${sections.length} markdown section(s) into cards.`,
      itemCount: cards.length,
    };
  }
  if (to === "quiz") {
    const sections = splitMarkdownByHeading(raw);
    const questions = sections.map((s, i) => ({
      id: `q-${i + 1}`,
      question: s.heading || `Section ${i + 1}`,
      options: ["", "", "", ""],
      correct: 0,
      explanation: s.body.trim(),
      tags: [],
      difficulty: 2,
    }));
    return {
      contentType: "quiz",
      body: JSON.stringify({ questions }, null, 2),
      summary: `Generated ${questions.length} open-ended question(s) from markdown sections.`,
      itemCount: questions.length,
    };
  }
  throw new Error(`Unsupported conversion: library → ${to}`);
}

function convertFromWritten(to: ContentType, parsed: any): ConvertResult {
  const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts : [];
  if (to === "library") {
    const md = prompts.map((p: any, i: number) =>
      `## Prompt ${i + 1}\n\n${stripMd(p.prompt ?? p.stem ?? "")}\n\n**Model answer:**\n\n${stripMd(p.modelAnswer ?? p.answer ?? "")}\n`,
    ).join("\n");
    return {
      contentType: "library",
      body: `# Converted Written Prompts\n\n${md}`,
      summary: `Rendered ${prompts.length} prompt(s) as a markdown study sheet.`,
      itemCount: prompts.length,
    };
  }
  if (to === "flashcard") {
    const cards = prompts.map((p: any, i: number) => ({
      id: `c-${i + 1}`,
      front: p.prompt ?? p.stem ?? "",
      back: p.modelAnswer ?? p.answer ?? "",
      tags: [],
    }));
    return {
      contentType: "flashcard",
      body: JSON.stringify({ cards }, null, 2),
      summary: `Generated ${cards.length} card(s) from prompts.`,
      itemCount: cards.length,
    };
  }
  if (to === "mixed") {
    const out = { ...parsed, type: "mixed", questions: [] as any[] };
    return {
      contentType: "mixed",
      body: JSON.stringify(out, null, 2),
      summary: `Kept ${prompts.length} prompt(s); add MCQ questions in the Mixed editor.`,
      itemCount: prompts.length,
    };
  }
  throw new Error(`Unsupported conversion: written → ${to}`);
}

function mixedMcq(parsed: any): { questions: any[]; passages: any[] } {
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const passages = Array.isArray(parsed?.passages) ? parsed.passages : [];
  return { questions, passages };
}

function convertFromMixed(to: ContentType, parsed: any): ConvertResult {
  const { questions, passages } = mixedMcq(parsed);
  const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts : [];
  const chapters = Array.isArray(parsed?.chapters) ? parsed.chapters : undefined;
  const flatMcq = [...questions, ...passages.flatMap((p: any) => Array.isArray(p.questions) ? p.questions : [])];

  if (to === "quiz") {
    const out: any = { questions: flatMcq };
    if (chapters) out.chapters = chapters;
    return {
      contentType: "quiz",
      body: JSON.stringify(out, null, 2),
      summary: `Kept ${flatMcq.length} MCQ question(s); dropped ${prompts.length} written prompt(s).`,
      itemCount: flatMcq.length,
    };
  }
  if (to === "bank") {
    const out: any = passages.length > 0
      ? { passages }
      : { passages: [{ id: "p-1", content: "", questions }] };
    if (chapters) out.chapters = chapters;
    return {
      contentType: "bank",
      body: JSON.stringify(out, null, 2),
      summary: `Kept ${passages.length > 0 ? passages.length : 1} passage(s); dropped ${prompts.length} written prompt(s).`,
      itemCount: flatMcq.length,
    };
  }
  if (to === "written") {
    const out: any = { prompts };
    if (chapters) out.chapters = chapters;
    return {
      contentType: "written",
      body: JSON.stringify(out, null, 2),
      summary: `Kept ${prompts.length} prompt(s); dropped ${flatMcq.length} MCQ question(s).`,
      itemCount: prompts.length,
    };
  }
  if (to === "library") {
    const mcqMd = flatMcq.map((q: any, i: number) =>
      `## Q${i + 1}. ${stripMd(q.question ?? q.stem ?? "")}\n\n${stripMd(q.explanation ?? "")}\n`,
    ).join("\n");
    const promptMd = prompts.map((p: any, i: number) =>
      `## Prompt ${i + 1}\n\n${stripMd(p.prompt ?? p.stem ?? "")}\n\n**Model answer:**\n\n${stripMd(p.modelAnswer ?? p.answer ?? "")}\n`,
    ).join("\n");
    return {
      contentType: "library",
      body: `# Converted Mixed Pack\n\n${mcqMd}\n${promptMd}`,
      summary: `Rendered ${flatMcq.length} MCQ question(s) + ${prompts.length} prompt(s) as a markdown study sheet.`,
      itemCount: flatMcq.length + prompts.length,
    };
  }
  throw new Error(`Unsupported conversion: mixed → ${to}`);
}

function convertFromOsce(to: ContentType, parsed: any): ConvertResult {
  const stations = Array.isArray(parsed?.stations) ? parsed.stations : [];
  if (to === "library") {
    const md = stations.map((s: any, i: number) => {
      const lines = [`## Station ${i + 1}: ${stripMd(s.title ?? s.name ?? "")}`];
      if (s.patientBrief) lines.push(`\n**Patient brief:** ${stripMd(s.patientBrief)}`);
      if (s.task) lines.push(`\n**Task:** ${stripMd(s.task)}`);
      const rubric = Array.isArray(s.rubric) ? s.rubric : [];
      if (rubric.length > 0) {
        lines.push("\n**Rubric:**");
        for (const r of rubric) lines.push(`- ${stripMd(typeof r === "string" ? r : (r.text ?? r.criterion ?? ""))}`);
      }
      return lines.join("\n");
    }).join("\n\n");
    return {
      contentType: "library",
      body: `# Converted OSCE Stations\n\n${md}`,
      summary: `Rendered ${stations.length} station(s) as a markdown study sheet.`,
      itemCount: stations.length,
    };
  }
  throw new Error(`Unsupported conversion: osce → ${to}`);
}

function convertFromVideo(to: ContentType, parsed: any): ConvertResult {
  const videos = Array.isArray(parsed?.videos) ? parsed.videos : [];
  if (to === "library") {
    const md = videos.map((v: any, i: number) =>
      `## ${i + 1}. ${stripMd(v.title ?? "Untitled")}\n\n- **URL:** ${v.url ?? v.youtubeId ?? ""}\n- **Duration:** ${v.duration ?? "?"}s\n${v.description ? `\n${stripMd(v.description)}\n` : ""}`,
    ).join("\n");
    return {
      contentType: "library",
      body: `# Converted Video List\n\n${md}`,
      summary: `Rendered ${videos.length} video(s) as a markdown link sheet.`,
      itemCount: videos.length,
    };
  }
  throw new Error(`Unsupported conversion: video → ${to}`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function safeParse(body: string): any {
  try { return JSON.parse(body); } catch { return null; }
}

function stripMd(s: string): string {
  return (s ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links
    .replace(/[*_`>#]/g, "") // emphasis
    .trim();
}

function splitMarkdownByHeading(md: string): Array<{ heading: string; body: string }> {
  const lines = md.split("\n");
  const sections: Array<{ heading: string; body: string }> = [];
  let current: { heading: string; body: string } | null = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (current) sections.push(current);
      current = { heading: line.replace(/^##\s+/, "").trim(), body: "" };
    } else if (current) {
      current.body += line + "\n";
    } else if (line.trim()) {
      // Preamble before any heading — synthesize a section so we don't lose it.
      current = { heading: "Introduction", body: line + "\n" };
    }
  }
  if (current) sections.push(current);
  return sections;
}
