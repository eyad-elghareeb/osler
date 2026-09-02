import { describe, it, expect } from "vitest";
import { parseMcqText, parseWrittenText } from "../mcp/pdf-structure";
import { findTool } from "../mcp/tools";

// Pure tests — the exam-PDF layout heuristics run on plain text arrays, no
// PDF runtime (unpdf is lazy-imported only inside the tools' run()).

describe("parseMcqText", () => {
  it("parses stems, A–E options, inline answers and explanations", () => {
    const pages = [
      [
        "1. A 58-year-old man presents with crushing chest pain radiating to the left arm.",
        "Which finding best confirms the diagnosis?",
        "A. Elevated D-dimer",
        "B. ST elevation in two contiguous leads",
        "C. Pleuritic pain",
        "D. Productive cough",
        "E. Low-grade fever",
        "Answer: B",
        "Explanation: ST elevation in two contiguous leads confirms STEMI.",
        "",
        "2. First-line drug in anaphylaxis?",
        "a) Oral antihistamine",
        "b) Intramuscular epinephrine",
        "c) IV corticosteroid",
        "d) Nebulised salbutamol",
        "Ans: b",
      ].join("\n"),
    ];
    const r = parseMcqText(pages);
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0].options).toHaveLength(5);
    expect(r.questions[0].correct).toBe(1);
    expect(r.questions[0].explanation).toContain("confirms STEMI");
    // lowercase option letters + "Ans:" variant still resolve, 0-indexed
    expect(r.questions[1].correct).toBe(1);
    expect(r.stats.inlineAnswers).toBe(2);
    expect(r.stats.missingAnswers).toBe(0);
  });

  it("resolves answers from a trailing key table (column and grid forms)", () => {
    const pages = [
      [
        "1. Best initial test for pulmonary embolism?",
        "A. D-dimer",
        "B. CTPA",
        "C. V/Q scan",
        "D. ECG",
        "E. Chest X-ray",
        "",
        "2. Test of choice for PE in pregnancy?",
        "A. CTPA",
        "B. V/Q scan",
        "C. MRI",
        "D. D-dimer",
        "E. Chest X-ray",
        "",
        "Answer Key",
        "1. B",
        "2 - D",
      ].join("\n"),
      ["1-B  2-D"].join("\n"), // grid-style key lines also feed the same map
    ];
    const r = parseMcqText(pages);
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0].correct).toBe(1);
    expect(r.questions[1].correct).toBe(3);
    expect(r.stats.keyTableAnswers).toBeGreaterThanOrEqual(2);
  });

  it("omits correct and warns when no answer is found, and skips option-less blocks", () => {
    const pages = [
      [
        "Cardiology Block A",
        "",
        "1. Which murmur radiates to the carotids?",
        "A. Mitral regurgitation",
        "B. Aortic stenosis",
        "",
        "2. Reference list entry that is not a question.",
      ].join("\n"),
    ];
    const r = parseMcqText(pages);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].correct).toBeUndefined();
    expect(r.stats.missingAnswers).toBe(1);
    expect(r.warnings.some((w) => w.includes("no answer found"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("no options detected"))).toBe(true);
  });
});

describe("parseWrittenText", () => {
  it("extracts prompts with marks, marking-scheme rubrics and model answers", () => {
    const pages = [
      [
        "1. Outline the diagnostic criteria for DKA. (10 marks)",
        "Model Answer:",
        "Hyperglycaemia >200 mg/dL, pH <7.3, bicarbonate <15 mEq/L, ketonaemia.",
        "",
        "Marking scheme:",
        "- Identifies biochemical criteria (4 marks)",
        "• Specifies fluid resuscitation protocol (3 marks)",
        "- Mentions potassium replacement (2 marks)",
        "",
        "2. Discuss the management of severe asthma in the ED.",
      ].join("\n"),
    ];
    const r = parseWrittenText(pages);
    expect(r.prompts).toHaveLength(2);
    expect(r.prompts[0].prompt).toContain("Outline the diagnostic criteria");
    expect(r.prompts[0].prompt).not.toContain("10 marks");
    expect(r.prompts[0].sampleAnswer).toContain("ketonaemia");
    expect(r.prompts[0].rubric).toHaveLength(3);
    expect(r.prompts[0].rubric![0].maxPoints).toBe(4);
    expect(r.prompts[0].rubric![1].maxPoints).toBe(3);
    // no marks annotation → default rubric with a warning
    expect(r.prompts[1].rubric![0].maxPoints).toBe(10);
    expect(r.warnings.some((w) => w.includes("no marks annotation"))).toBe(true);
  });
});

describe("PDF tools registration", () => {
  it("announces the parse tools", () => {
    for (const name of ["parse_pdf", "parse_qbank_pdf", "parse_written_pdf"]) {
      expect(findTool(name)?.inputSchema.required).toEqual(["pdfDataUri"]);
    }
  });
});
