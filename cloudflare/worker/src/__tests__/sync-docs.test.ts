import { describe, it, expect } from "vitest";
import { mergeQbank, mergeFlashcards, gzipString, gunzipString, gunzipBytes } from "../sync-docs";

describe("mergeQbank", () => {
  it("adds new records from local", () => {
    const r = mergeQbank({}, { "u:q1": { uid: "u", qid: "q1", correct: true, timestamp: 100 } });
    expect(r.changed).toBe(true);
    expect(r.records["u:q1"].correct).toBe(true);
  });

  it("keeps the newer record on conflict", () => {
    const remote = { "u:q1": { uid: "u", qid: "q1", correct: false, timestamp: 100 } };
    const local = { "u:q1": { uid: "u", qid: "q1", correct: true, timestamp: 200 } };
    const r = mergeQbank(remote, local);
    expect(r.records["u:q1"].correct).toBe(true);
    expect(r.changed).toBe(true);
  });

  it("ignores older local records", () => {
    const remote = { "u:q1": { uid: "u", qid: "q1", correct: true, timestamp: 200 } };
    const local = { "u:q1": { uid: "u", qid: "q1", correct: false, timestamp: 100 } };
    const r = mergeQbank(remote, local);
    expect(r.records["u:q1"].correct).toBe(true);
    expect(r.changed).toBe(false);
  });

  it("reports no change when local is a no-op re-push", () => {
    const records = { "u:q1": { uid: "u", qid: "q1", correct: true, timestamp: 100 } };
    const r = mergeQbank(records, records);
    expect(r.changed).toBe(false);
  });

  it("preserves remote-only records", () => {
    const remote = { "u:q1": { uid: "u", qid: "q1", correct: true, timestamp: 100 } };
    const r = mergeQbank(remote, { "u:q2": { uid: "u", qid: "q2", correct: false, timestamp: 50 } });
    expect(r.records["u:q1"]).toBeDefined();
    expect(r.records["u:q2"]).toBeDefined();
  });
});

describe("mergeFlashcards", () => {
  it("merges on lastReviewed", () => {
    const remote = { "d:c1": { ease: 2.5, lastReviewed: 100 } };
    const local = { "d:c1": { ease: 2.7, lastReviewed: 200 } };
    const r = mergeFlashcards(remote, local);
    expect(r.records["d:c1"].ease).toBe(2.7);
    expect(r.changed).toBe(true);
  });

  it("ignores stale flashcards", () => {
    const remote = { "d:c1": { ease: 2.7, lastReviewed: 200 } };
    const local = { "d:c1": { ease: 2.0, lastReviewed: 50 } };
    const r = mergeFlashcards(remote, local);
    expect(r.records["d:c1"].ease).toBe(2.7);
    expect(r.changed).toBe(false);
  });
});

describe("gzip codec", () => {
  it("round-trips a string through base64 gzip", async () => {
    const text = JSON.stringify({ a: 1, b: "hello", list: [1, 2, 3] });
    const compressed = await gzipString(text);
    const decompressed = await gunzipString(compressed);
    expect(decompressed).toBe(text);
  });

  it("round-trips raw bytes through gunzipBytes", async () => {
    const text = "some large payload ".repeat(1000);
    const compressed = await gzipString(text);
    const bytes = Uint8Array.from(atob(compressed), (c) => c.charCodeAt(0));
    expect(await gunzipBytes(bytes)).toBe(text);
  });

  it("compresses repetitive content well below raw size", async () => {
    const text = JSON.stringify({ records: Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`u:q${i}`, { uid: "u", qid: `q${i}`, correct: i % 2 === 0, flagged: false, timestamp: 1_000_000_000 + i }]),
    ) });
    const compressed = await gzipString(text);
    const decoded = atob(compressed);
    expect(decoded.length).toBeLessThan(text.length / 3);
  });
});
