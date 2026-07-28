import { describe, it, expect } from "vitest";

// Pure function tests — these don't need Cloudflare runtime
function validUsername(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{3,32}$/.test(value);
}
function validEmail(value: unknown): value is string {
  return !value || (typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254);
}
function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128 &&
    [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(value)).length >= 2;
}
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
function validate(obj: any, rules: { field: string; type: string; required?: boolean; min?: number; max?: number }[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const rule of rules) {
    const val = obj[rule.field];
    if (rule.required && (val === undefined || val === null || val === "")) {
      errors.push(`${rule.field} is required`);
      continue;
    }
    if (val !== undefined && val !== null && val !== "") {
      if (rule.type === "string" && typeof val !== "string") errors.push(`${rule.field} must be a string`);
      if (rule.min !== undefined && typeof val === "string" && val.length < rule.min) errors.push(`${rule.field} must be at least ${rule.min} characters`);
      if (rule.max !== undefined && typeof val === "string" && val.length > rule.max) errors.push(`${rule.field} must be at most ${rule.max} characters`);
    }
  }
  return { valid: errors.length === 0, errors };
}
function validateContent(contentType: string, parsed: any): string[] {
  const errors: string[] = [];
  if (!parsed || typeof parsed !== "object") return ["Content must be a JSON object"];
  const vid = (v: any) => typeof v === "string" && v.trim().length > 0;
  if (contentType === "quiz") {
    const qs = parsed.questions;
    if (!Array.isArray(qs)) return ["quiz: `questions` array required"];
    qs.forEach((q: any, i: number) => {
      const p = `questions[${i}]`;
      if (!vid(q.id)) errors.push(`${p}: id required`);
      if (typeof q.question !== "string" || !q.question.trim()) errors.push(`${p}: question text required`);
      if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`${p}: at least 2 options required`);
      if (typeof q.correct !== "number" || q.correct < 0 || q.correct >= (q.options?.length ?? 0)) errors.push(`${p}: correct index out of bounds`);
    });
  } else if (contentType === "flashcard") {
    const cs = parsed.cards;
    if (!Array.isArray(cs)) return ["flashcard: `cards` array required"];
    cs.forEach((c: any, i: number) => {
      const prefix = `cards[${i}]`;
      if (!vid(c.id)) errors.push(`${prefix}: id required`);
      if (c.type === "cloze") {
        if (typeof c.text !== "string" || !c.text.trim()) errors.push(`${prefix}: cloze card requires text`);
      } else {
        if (typeof c.front !== "string" || !c.front.trim()) errors.push(`${prefix}: front required`);
        if (typeof c.back !== "string" || !c.back.trim()) errors.push(`${prefix}: back required`);
      }
    });
  }
  return errors;
}

describe("validUsername", () => {
  it("accepts valid usernames", () => {
    expect(validUsername("john_doe")).toBe(true);
    expect(validUsername("user123")).toBe(true);
    expect(validUsername("a-b.c")).toBe(true);
  });
  it("rejects too short", () => {
    expect(validUsername("ab")).toBe(false);
  });
  it("rejects invalid characters", () => {
    expect(validUsername("user name")).toBe(false);
    expect(validUsername("user!name")).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(validUsername(123)).toBe(false);
    expect(validUsername(null)).toBe(false);
  });
});

describe("validEmail", () => {
  it("accepts valid emails", () => {
    expect(validEmail("test@example.com")).toBe(true);
    expect(validEmail("a.b@c.co")).toBe(true);
  });
  it("accepts null/empty (optional)", () => {
    expect(validEmail(null)).toBe(true);
    expect(validEmail("")).toBe(true);
  });
  it("rejects invalid", () => {
    expect(validEmail("notanemail")).toBe(false);
    expect(validEmail("@b.com")).toBe(false);
  });
});

describe("validPassword", () => {
  it("accepts valid passwords (8+ chars, 2+ classes)", () => {
    expect(validPassword("password1")).toBe(true);
    expect(validPassword("Password!")).toBe(true);
    expect(validPassword("abc123XYZ")).toBe(true);
  });
  it("rejects too short", () => {
    expect(validPassword("Ab1")).toBe(false);
  });
  it("rejects single-class", () => {
    expect(validPassword("abcdefgh")).toBe(false);
    expect(validPassword("12345678")).toBe(false);
  });
});

describe("escapeLike", () => {
  it("escapes SQL LIKE special chars", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("foo_bar")).toBe("foo\\_bar");
    expect(escapeLike("test\\")).toBe("test\\\\");
  });
});

describe("validate helper", () => {
  it("returns valid for matching rules", () => {
    const r = validate({ name: "hello" }, [{ field: "name", type: "string", required: true, min: 1, max: 10 }]);
    expect(r.valid).toBe(true);
  });
  it("returns errors for missing required", () => {
    const r = validate({}, [{ field: "name", type: "string", required: true }]);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("name is required");
  });
});

describe("validateContent", () => {
  it("validates a quiz correctly", () => {
    const good = { questions: [{ id: "q1", question: "What?", options: ["A", "B"], correct: 0 }] };
    expect(validateContent("quiz", good)).toEqual([]);
    const bad = { questions: [{ id: "q1", question: "", options: ["A"], correct: -1 }] };
    const errs = validateContent("quiz", bad);
    expect(errs.length).toBeGreaterThan(0);
  });
  it("validates flashcards", () => {
    const good = { cards: [{ id: "c1", front: "Q", back: "A" }] };
    expect(validateContent("flashcard", good)).toEqual([]);
    const bad = { cards: [{ id: "c1", front: "", back: "" }] };
    expect(validateContent("flashcard", bad).length).toBeGreaterThan(0);
  });
  it("rejects non-object", () => {
    expect(validateContent("quiz", null)).toEqual(["Content must be a JSON object"]);
  });
  it("returns empty for library (no schema)", () => {
    expect(validateContent("library", {})).toEqual([]);
  });
});
