import { describe, it, expect } from "vitest";
import { copyPackAssets, type R2BucketLike } from "../duplicate-content";

/** In-memory R2 bucket stand-in with configurable page size + failure keys. */
function makeBucket(opts: {
  keys: string[];
  pageSize?: number;
  vanishKeys?: string[];
  failPuts?: string[];
} & Record<string, unknown>): R2BucketLike & { puts: Array<[string, string]> } {
  const pageSize = opts.pageSize ?? 100;
  const stored = new Map(opts.keys.map((k) => [k, new ArrayBuffer(8)]));
  const puts: Array<[string, string]> = [];
  let callSeq = 0;
  return {
    puts,
    async list({ prefix, limit, cursor }) {
      const all = opts.keys
        .filter((k) => k.startsWith(prefix))
        .sort();
      const startIdx = cursor ? Number(cursor) : 0;
      const slice = all.slice(startIdx, startIdx + Math.min(limit, pageSize));
      const nextIdx = startIdx + slice.length;
      const truncated = nextIdx < all.length;
      callSeq++;
      return {
        objects: slice.map((key) => ({ key })),
        truncated,
        cursor: truncated ? String(nextIdx) : undefined,
      };
    },
    async get(key) {
      if (opts.vanishKeys?.includes(key)) return null;
      if (!stored.has(key)) return null;
      return {
        arrayBuffer: async () => stored.get(key)!,
        httpMetadata: { contentType: key.endsWith(".png") ? "image/png" : "application/octet-stream" },
      };
    },
    async put(key, _value) {
      if (opts.failPuts?.includes(key)) throw new Error(`boom:${key}`);
      puts.push([key, "ok"]);
    },
  };
}

describe("copyPackAssets", () => {
  const SRC = "content/quiz/src-1";
  const DEST = "content/quiz/dest-1";

  it("copies regular assets and skips workflow slot files", async () => {
    const bucket = makeBucket({
      keys: [
        `${SRC}/draft.json`,
        `${SRC}/pending.json`,
        `${SRC}/published.json`,
        `${SRC}/images/ecg.png`,
        `${SRC}/images/notes.md`,
      ],
    });
    const r = await copyPackAssets(bucket, SRC, DEST);
    expect(r.assetsCopied).toBe(2);
    expect(r.failedAssets).toEqual([]);
    expect(r.truncated).toBe(false);
    expect(bucket.puts.map(([k]) => k).sort()).toEqual([
      `${DEST}/images/ecg.png`,
      `${DEST}/images/notes.md`,
    ]);
  });

  it("paginates through cursors until the listing is complete", async () => {
    // 250 assets with page size 100 → 3 pages, all copied.
    const keys = Array.from({ length: 250 }, (_, i) => `${SRC}/images/a-${String(i).padStart(3, "0")}.png`);
    const bucket = makeBucket({ keys, pageSize: 100 });
    const r = await copyPackAssets(bucket, SRC, DEST);
    expect(r.assetsCopied).toBe(250);
    expect(r.truncated).toBe(false);
    expect(r.failedAssets).toEqual([]);
  });

  it("stops at the page bound and reports truncated", async () => {
    // 1200 assets with page size 100 → needs 12 pages, bound is 10.
    const keys = Array.from({ length: 1200 }, (_, i) => `${SRC}/images/a-${String(i).padStart(4, "0")}.png`);
    const bucket = makeBucket({ keys, pageSize: 100 });
    const r = await copyPackAssets(bucket, SRC, DEST, 10);
    expect(r.assetsCopied).toBe(1000);
    expect(r.truncated).toBe(true);
    expect(r.failedAssets).toEqual([]);
  });

  it("collects per-asset failures instead of aborting the copy", async () => {
    const bucket = makeBucket({
      keys: [`${SRC}/images/ok.png`, `${SRC}/images/bad.png`],
      failPuts: [`${DEST}/images/bad.png`],
    });
    const r = await copyPackAssets(bucket, SRC, DEST);
    expect(r.assetsCopied).toBe(1);
    expect(r.failedAssets).toEqual([{ path: "images/bad.png", error: `boom:${DEST}/images/bad.png` }]);
  });

  it("reports assets that vanish between list and get", async () => {
    const bucket = makeBucket({
      keys: [`${SRC}/images/here.png`, `${SRC}/images/gone.png`],
      vanishKeys: [`${SRC}/images/gone.png`],
    });
    const r = await copyPackAssets(bucket, SRC, DEST);
    expect(r.assetsCopied).toBe(1);
    expect(r.failedAssets).toEqual([{ path: "images/gone.png", error: "asset vanished mid-copy" }]);
  });

  it("preserves the asset content type on the destination object", async () => {
    const seenMeta: Array<string | undefined> = [];
    const keys = [`${SRC}/images/ecg.png`];
    const bucket: R2BucketLike = {
      async list({ prefix }) {
        return { objects: keys.filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
      },
      async get(key) {
        return { arrayBuffer: async () => new ArrayBuffer(4), httpMetadata: { contentType: "image/png" } };
      },
      async put(_key, _value, opts) {
        seenMeta.push(opts?.httpMetadata?.contentType);
      },
    };
    await copyPackAssets(bucket, SRC, DEST);
    expect(seenMeta).toEqual(["image/png"]);
  });

  it("handles an empty source prefix cleanly", async () => {
    const bucket = makeBucket({ keys: [] });
    const r = await copyPackAssets(bucket, SRC, DEST);
    expect(r).toEqual({ assetsCopied: 0, failedAssets: [], truncated: false });
  });
});
