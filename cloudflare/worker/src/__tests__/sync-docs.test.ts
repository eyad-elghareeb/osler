import { describe, it, expect } from "vitest";
import { mergeQbank, mergeFlashcards, mergeKind, SYNC_KINDS, gzipString, gunzipString, gunzipBytes, gunzipBytesBounded } from "../sync-docs";

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

describe("mergeKind — sessions", () => {
  it("merges saved sessions on completedAt with startedAt fallback", () => {
    const remote = { "s1": { id: "s1", startedAt: 100, completedAt: 200, score: 60 } };
    const local = { "s1": { id: "s1", startedAt: 100, completedAt: 300, score: 80 } };
    const r = mergeKind(remote, local, "sessions");
    expect(r.records["s1"].score).toBe(80);
    expect(r.changed).toBe(true);
  });

  it("merges in-progress sessions via startedAt", () => {
    const remote = { "s2": { id: "s2", startedAt: 500 } };
    const local = { "s2": { id: "s2", startedAt: 600, currentIndex: 4 } };
    const r = mergeKind(remote, local, "sessions");
    expect(r.records["s2"].currentIndex).toBe(4);
  });
});

describe("mergeKind — notes", () => {
  it("keeps the note with the latest updatedAt", () => {
    const remote = { "n1": { id: "n1", updatedAt: 100, text: "old" } };
    const local = { "n1": { id: "n1", updatedAt: 200, text: "new" } };
    const r = mergeKind(remote, local, "notes");
    expect(r.records["n1"].text).toBe("new");
    expect(r.changed).toBe(true);
  });
});

describe("mergeKind — highlights / articleHighlights", () => {
  it("merges item lists by id and keeps the newer item", () => {
    const remote = { "u:q1": [{ id: "h1", text: "a", createdAt: 100 }, { id: "h2", text: "b", createdAt: 150 }] };
    const local = { "u:q1": [{ id: "h1", text: "a edited", createdAt: 200 }], "u:q2": [{ id: "h3", text: "c", createdAt: 50 }] };
    const r = mergeKind(remote, local, "highlights");
    expect(r.records["u:q1"]).toHaveLength(2);
    expect(r.records["u:q1"].find((h: any) => h.id === "h1").text).toBe("a edited");
    expect(r.records["u:q2"]).toHaveLength(1);
    expect(r.changed).toBe(true);
  });

  it("reports no change on a no-op re-push", () => {
    const doc = { "u:q1": [{ id: "h1", text: "a", createdAt: 100 }] };
    const r = mergeKind(doc, doc, "articleHighlights");
    expect(r.changed).toBe(false);
  });

  it("a tombstone (deletedAt) out-ranks the older live item on every replica", () => {
    // Device B deleted highlight h1 → its doc carries only the tombstone.
    const now = Date.now();
    const tombstone = { id: "h1", deletedAt: now - 1_000, updatedAt: now - 1_000 };
    const live = { id: "h1", text: "still there", color: "yellow", createdAt: now - 60_000 };
    // Push from the deleting device: server doc holds the live item.
    const pushed = mergeKind({ "u:q1": [live] }, { "u:q1": [tombstone] }, "highlights");
    expect(pushed.records["u:q1"].find((h: any) => h.id === "h1").deletedAt).toBe(now - 1_000);
    expect(pushed.changed).toBe(true);
    // Another device that missed the deletion pushes its stale live copy —
    // the tombstone must win so the highlight is not resurrected.
    const stale = mergeKind({ "u:q1": [tombstone] }, { "u:q1": [live] }, "highlights");
    expect(stale.records["u:q1"].find((h: any) => h.id === "h1").deletedAt).toBe(now - 1_000);
  });

  it("keeps live items created after the tombstone (re-highlight is not suppressed)", () => {
    const tombstone = { id: "h1", deletedAt: 5_000, updatedAt: 5_000 };
    const rehighlight = { id: "h1", text: "new", color: "green", createdAt: 9_000 };
    const r = mergeKind({ "u:q1": [tombstone] }, { "u:q1": [rehighlight] }, "highlights");
    expect(r.records["u:q1"].find((h: any) => h.id === "h1").text).toBe("new");
  });

  it("prunes tombstones past the retention window", () => {
    const now = Date.now();
    const expired = { id: "h1", deletedAt: now - 91 * 86_400_000, updatedAt: now - 91 * 86_400_000 };
    const fresh = { id: "h2", deletedAt: now - 1_000, updatedAt: now - 1_000 };
    const r = mergeKind({}, { "u:q1": [expired, fresh] }, "articleHighlights");
    const ids = r.records["u:q1"].map((h: any) => h.id);
    expect(ids).not.toContain("h1");
    expect(ids).toContain("h2");
    expect(r.changed).toBe(true);
  });
});

describe("mergeKind — bookmarks", () => {
  it("unions bookmark paths and wins on add", () => {
    const remote = { "physics/thermo": 1 };
    const local = { "cardio/mi": 1 };
    const r = mergeKind(remote, local, "bookmarks");
    expect(r.records).toEqual({ "physics/thermo": 1, "cardio/mi": 1 });
    expect(r.changed).toBe(true);
  });

  it("reports no change when nothing new is added", () => {
    const remote = { "a": 1, "b": 1 };
    const r = mergeKind(remote, { "b": 1 }, "bookmarks");
    expect(r.changed).toBe(false);
  });
});

describe("SYNC_KINDS", () => {
  it("covers every kind merged by the worker", () => {
    expect(SYNC_KINDS).toEqual(["qbank", "flashcards", "sessions", "notes", "highlights", "articleHighlights", "writtenDrafts", "bookmarks", "achievements", "settings"]);
  });
});

describe("mergeKind — achievements", () => {
  it("merges on unlockedAt, keeping the later unlock", () => {
    const remote = { "first-steps": { id: "first-steps", unlockedAt: 100 } };
    const local = { "first-steps": { id: "first-steps", unlockedAt: 200 }, "marathon": { id: "marathon", unlockedAt: 300 } };
    const r = mergeKind(remote, local, "achievements");
    expect(r.records["first-steps"].unlockedAt).toBe(200);
    expect(r.records["marathon"].unlockedAt).toBe(300);
    expect(r.changed).toBe(true);
  });

  it("ignores older unlocks and reports no change on a no-op re-push", () => {
    const doc = { "first-steps": { id: "first-steps", unlockedAt: 100 } };
    const r = mergeKind(doc, doc, "achievements");
    expect(r.records["first-steps"].unlockedAt).toBe(100);
    expect(r.changed).toBe(false);
  });
});

describe("mergeKind — writtenDrafts", () => {
  it("deep-merges a pack's draft map per question key, incoming wins on tie", () => {
    const remote = { "pack1": { "q0": { text: "old", rubricChecked: [true], submitted: false }, "q1": { text: "keep", rubricChecked: [], submitted: true } } };
    const local = { "pack1": { "q0": { text: "new", rubricChecked: [true], submitted: true } }, "pack2": { "q0": { text: "other", rubricChecked: [], submitted: false } } };
    const r = mergeKind(remote, local, "writtenDrafts");
    expect(r.records).toEqual({
      "pack1": { "q0": { text: "new", rubricChecked: [true], submitted: true }, "q1": { text: "keep", rubricChecked: [], submitted: true } },
      "pack2": { "q0": { text: "other", rubricChecked: [], submitted: false } },
    });
    expect(r.changed).toBe(true);
  });

  it("reports no change on a no-op re-push", () => {
    const doc = { "pack1": { "q0": { text: "a", rubricChecked: [], submitted: true } } };
    const r = mergeKind(doc, doc, "writtenDrafts");
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

  it("gunzipBytesBounded returns content within the cap", async () => {
    const text = "some large payload ".repeat(1000);
    const compressed = await gzipString(text);
    const bytes = Uint8Array.from(atob(compressed), (c) => c.charCodeAt(0));
    expect(await gunzipBytesBounded(bytes, text.length)).toBe(text);
  });

  it("gunzipBytesBounded aborts when the cap is exceeded", async () => {
    const text = "some large payload ".repeat(1000);
    const compressed = await gzipString(text);
    const bytes = Uint8Array.from(atob(compressed), (c) => c.charCodeAt(0));
    await expect(gunzipBytesBounded(bytes, 100)).rejects.toThrow("Request body is too large");
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
