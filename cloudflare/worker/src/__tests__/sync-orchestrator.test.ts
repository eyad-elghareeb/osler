import { describe, it, expect } from "vitest";

import {
  SEGMENT_SOFT_CAP_BYTES,
  SEGMENTED_KINDS,
  baseKindOfRow,
  isSegmentRow,
  packKindSegments,
  segmentKind,
  splitSegmentKind,
} from "../sync-orchestrator";

const encoder = new TextEncoder();

describe("sync orchestrator: kind mapping", () => {
  it("splits segment kinds and rejects malformed ones", () => {
    expect(splitSegmentKind("qbank:2")).toEqual({ base: "qbank", index: 2 });
    expect(splitSegmentKind("qbank")).toBeNull();
    expect(splitSegmentKind("qbank:")).toBeNull();
    expect(splitSegmentKind("qbank:x")).toBeNull();
    expect(splitSegmentKind("qbank:0")).toBeNull();
    expect(splitSegmentKind(":2")).toBeNull();
  });

  it("treats only segmented kinds' numbered rows as segments", () => {
    expect(SEGMENTED_KINDS.has("qbank")).toBe(true);
    expect(isSegmentRow("qbank:1")).toBe(true);
    expect(isSegmentRow("qbank:10")).toBe(true);
    expect(isSegmentRow("flashcards:1")).toBe(false);
    expect(isSegmentRow("flashcards")).toBe(false);
    expect(baseKindOfRow("qbank:3")).toBe("qbank");
    expect(baseKindOfRow("qbank")).toBe("qbank");
    expect(baseKindOfRow("sessions")).toBe("sessions");
    expect(segmentKind("qbank", 2)).toBe("qbank:2");
  });
});

describe("sync orchestrator: packing", () => {
  it("packs a small kind into a single segment", () => {
    const records = { a: { v: 1 }, b: { v: 2 } };
    const { segments, deleteKinds } = packKindSegments("qbank", records);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("qbank:1");
    expect(segments[0].records).toEqual(records);
    expect(JSON.parse(segments[0].json)).toEqual(records);
    expect(deleteKinds).toEqual([]);
  });

  it("fills segments one by one, starting a new one at 85% occupancy", () => {
    const records: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) records[`question-${i}`] = { pad: "x".repeat(100_000) };
    const { segments, deleteKinds } = packKindSegments("qbank", records);
    expect(segments.length).toBeGreaterThan(1);
    // Every segment but the last sits just under the soft cap (the crossing
    // record moved on); the last holds the remainder.
    for (let i = 0; i < segments.length - 1; i++) {
      const bytes = encoder.encode(segments[i].json).length;
      expect(bytes).toBeGreaterThan(SEGMENT_SOFT_CAP_BYTES - 250_000);
      expect(bytes).toBeLessThanOrEqual(SEGMENT_SOFT_CAP_BYTES + 250_000);
    }
    // Records are disjoint across segments and nothing is lost.
    const keys = segments.flatMap((s) => Object.keys(s.records));
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(records).sort()).toEqual(keys.sort());
    expect(deleteKinds).toEqual([]);
  });

  it("gives a single oversized record its own segment", () => {
    const big = { pad: "y".repeat(SEGMENT_SOFT_CAP_BYTES + 1_000) };
    const { segments } = packKindSegments("qbank", { big, small: { v: 1 } });
    expect(segments).toHaveLength(2);
    expect(segments[0].records.big).toBe(big);
    expect(segments[1].records.small).toEqual({ v: 1 });
  });

  it("marks segment rows beyond the new layout for deletion", () => {
    const { segments, deleteKinds } = packKindSegments("qbank", { a: { v: 1 } }, 4);
    expect(segments.map((s) => s.kind)).toEqual(["qbank:1"]);
    expect(deleteKinds).toEqual(["qbank:2", "qbank:3", "qbank:4"]);
  });

  it("returns no segments for an emptied kind and deletes all existing rows", () => {
    const { segments, deleteKinds } = packKindSegments("qbank", {}, 2);
    expect(segments).toHaveLength(0);
    expect(deleteKinds).toEqual(["qbank:1", "qbank:2"]);
  });
});
