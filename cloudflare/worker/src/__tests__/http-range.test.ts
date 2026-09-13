import { describe, it, expect } from "vitest";
import { parseHttpRange } from "../http-range";

describe("parseHttpRange", () => {
  it("returns null when there is no Range header", () => {
    expect(parseHttpRange(null, 1000)).toBeNull();
    expect(parseHttpRange(undefined, 1000)).toBeNull();
    expect(parseHttpRange("", 1000)).toBeNull();
  });
  it("parses a closed range", () => {
    expect(parseHttpRange("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 });
  });
  it("parses an open-ended range", () => {
    expect(parseHttpRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });
  it("parses a suffix range", () => {
    expect(parseHttpRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
  });
  it("clamps an over-long end to the object size", () => {
    expect(parseHttpRange("bytes=0-9999", 1000)).toEqual({ start: 0, end: 999 });
  });
  it("clamps an over-long suffix to the whole object", () => {
    expect(parseHttpRange("bytes=-9999", 1000)).toEqual({ start: 0, end: 999 });
  });
  it("rejects a start past the end as unsatisfiable", () => {
    expect(parseHttpRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseHttpRange("bytes=5000-6000", 1000)).toBe("unsatisfiable");
  });
  it("rejects an inverted range as unsatisfiable", () => {
    expect(parseHttpRange("bytes=600-100", 1000)).toBe("unsatisfiable");
  });
  it("answers multi-range and non-bytes headers with a full 200 (null)", () => {
    expect(parseHttpRange("bytes=0-10, 20-30", 1000)).toBeNull();
    expect(parseHttpRange("items=0-10", 1000)).toBeNull();
    expect(parseHttpRange("bytes=abc-def", 1000)).toBeNull();
  });
});
