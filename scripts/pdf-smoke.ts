/**
 * Smoke test: exercises every PDF engine end-to-end in Node (core-font
 * fallback since /fonts isn't fetched here) and validates structure:
 * page counts, per-question answer-key hyperlinks, async barrel wrappers,
 * RTL/Arabic runs, two-column flow, written questions, review lists.
 */
import { generateQuizCompilationPdf, generateResultsPdf, generateDashboardPdf, generateArticlePdf } from "../src/lib/osler/pdf/index";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const q = (over: Partial<{ stem: string; choices: string[]; correct: number; explanation: string }> = {}) => ({
  stem: over.stem ?? "A 58-year-old smoker presents with hemoptysis. What is the most likely diagnosis?",
  choices: over.choices ?? ["Tuberculosis", "Lung carcinoma", "Sarcoidosis", "Bronchiectasis"],
  correct: over.correct ?? 1,
  explanation: over.explanation ?? "Smoking plus hemoptysis strongly suggests malignancy.",
});

async function main(): Promise<void> {
  // ── Results PDF (session report): tutor-style marks, status lines, key links
  const LONG_EXPL = "Key discriminators include imaging findings, biomarker trends, and response to diuresis. ".repeat(140);
  const questions = [
    q(), // user answered correctly (index 1)
    q({ stem: "Which finding suggests ARDS rather than cardiogenic pulmonary edema?", correct: 2, explanation: LONG_EXPL }), // user wrong
    q({ stem: "Long stem — ".repeat(60) + "What next?", correct: 0, explanation: LONG_EXPL }), // unanswered, long stem
    { ...q(), correct: -1, modelAnswer: "Discuss management.", rubric: ["Lists oxygen targets", "Mentions PEEP"], isWritten: true },
  ];
  const resultsDoc = await generateResultsPdf({
    packTitle: "Cardio Block Test",
    mode: "tutor",
    score: { pct: 50, correct: 2, total: 4, answered: 3, incorrect: 1, flagged: 1, percentile: 62, totalTime: "12:00", avgTime: "04:00" },
    questions,
    userAnswers: { 0: 1, 1: 0 },
    revealed: { 0: true, 1: true, 3: true },
    flagged: {},
    opts: {
      title: "Session Report", subtitle: "Tutor Mode", author: "Tester",
      includeCover: true, page: { pageSize: "a4", orientation: "portrait" },
      styleMode: "standard", answersMode: "endbook", showExplanations: true,
      twoCol: true, fontSize: "medium", fontType: "serif", lang: "en",
    },
  });
  const pages = resultsDoc.getNumberOfPages();
  assert(pages >= 6, `results PDF generated with ${pages} pages`);
  const size = resultsDoc.output("arraybuffer").byteLength;
  assert(size > 20_000, `results PDF has substance (${size} bytes)`);

  // Per-question hyperlinks: parse the serialized PDF — every /Dest link must
  // point at a valid page object, and the three answered questions' links
  // must NOT all collapse onto the key's first page.
  const rawPdf = Buffer.from(resultsDoc.output("arraybuffer")).toString("latin1");
  const pageIdByIndex = new Map<string, number>();
  let idx = 0;
  for (const m of rawPdf.matchAll(/(\d+) 0 obj\s*<<\s*\/Type \/Page\b/g)) {
    idx += 1;
    pageIdByIndex.set(m[1], idx);
  }
  assert(pageIdByIndex.size === pages, `serialized page objects match page count (${pageIdByIndex.size})`);
  const dests = [...rawPdf.matchAll(/\/Subtype \/Link[^[]*\/Rect \[[^\]]*\] ?\/Border \[0 0 0\] ?\/Dest \[(\d+) 0 R/g)]
    .map((m) => pageIdByIndex.get(m[1]));
  assert(dests.length === 3 && dests.every((p) => p !== undefined), `three question->answer links, all valid (got ${JSON.stringify(dests)})`);
  assert(new Set(dests).size >= 2, `links resolve to distinct answer pages (${JSON.stringify(dests)})`);

  // ── Compilation PDF: multi-chapter, TOC, endchapter keys, Arabic title
  const compDoc = await generateQuizCompilationPdf({
    page: { pageSize: "a4", orientation: "portrait" },
    cover: { title: "بنك أسئلة الفصل الأول", description: "Multi-chapter booklet", features: ["Feature one"] },
    includeCover: true, styleMode: "standard", answersMode: "endchapter",
    showExplanations: true, twoCol: true, lang: "ar",
    chapters: [
      { title: "Cardiology", description: "Heart basics", questions: [q(), q({ correct: 0 })] },
      { title: "Pulmonology", questions: [q({ choices: ["أ", "ب", "ج"], correct: 2 })] },
    ],
  });
  assert(compDoc.getNumberOfPages() >= 6, `compilation PDF generated with ${compDoc.getNumberOfPages()} pages`);

  // ── Dashboard report (session theme)
  const dashDoc = await generateDashboardPdf({
    username: "Tester",
    stats: { packs: 3, attempted: 40, correct: 31, accuracy: 78 },
    recentPacks: [{ title: "Pack A", engine: "quiz", attempted: 20, correct: 17, lastAttempt: Date.now() }],
    opts: {
      title: "Progress", author: "Tester", includeCover: true,
      page: { pageSize: "a4", orientation: "portrait" }, styleMode: "compact",
      answersMode: "none", showExplanations: false, twoCol: false, lang: "en",
    },
  });
  assert(dashDoc.getNumberOfPages() >= 2, `dashboard PDF generated with ${dashDoc.getNumberOfPages()} pages`);

  // ── Article PDF (Node has no DOMParser → flat-text fallback path)
  const artDoc = await generateArticlePdf({
    title: "Acute Coronary Syndromes",
    subtitle: "Cardiology",
    author: "Osler",
    content: "<h2>Overview</h2><p>ACS spans <strong>unstable angina</strong> to <em>NSTEMI</em> and STEMI.</p><table><tr><th>Type</th></tr><tr><td>STEMI</td></tr></table>",
    opts: {
      title: "ACS", author: "Osler", includeCover: true,
      page: { pageSize: "a4", orientation: "portrait" }, styleMode: "standard",
      answersMode: "none", showExplanations: false, twoCol: false, lang: "en",
    },
  });
  assert(artDoc.getNumberOfPages() >= 2, `article PDF generated with ${artDoc.getNumberOfPages()} pages`);

  console.log(process.exitCode ? "\nSMOKE TEST FAILED" : "\nALL SMOKE TESTS PASSED");
}

void main();
