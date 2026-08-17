import { describe, it, expect } from "vitest";

function isManagedOnly(env: { CONTENT_ONLY_MANAGED?: string | boolean }): boolean {
  return env.CONTENT_ONLY_MANAGED === "true" || env.CONTENT_ONLY_MANAGED === "1" || env.CONTENT_ONLY_MANAGED === true;
}

function sanitizeAssetRelPath(rel: string): string | null {
  const cleaned = (rel || "").trim().replace(/^\/+|\/+$/g, "");
  if (!cleaned || cleaned.includes("..") || cleaned.includes("\\")) return null;
  return cleaned.includes("/") ? cleaned : `images/${cleaned}`;
}

function guessImageContentType(filename: string): string {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "json": return "application/json";
    case "md": return "text/markdown; charset=utf-8";
    case "html":
    case "htm": return "text/html; charset=utf-8";
    case "svg": return "image/svg+xml";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "avif": return "image/avif";
    case "bmp": return "image/bmp";
    case "ico": return "image/x-icon";
    case "pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}

describe("isManagedOnly helper", () => {
  it("returns true for string 'true'", () => {
    expect(isManagedOnly({ CONTENT_ONLY_MANAGED: "true" })).toBe(true);
  });
  it("returns true for string '1'", () => {
    expect(isManagedOnly({ CONTENT_ONLY_MANAGED: "1" })).toBe(true);
  });
  it("returns true for boolean true", () => {
    expect(isManagedOnly({ CONTENT_ONLY_MANAGED: true })).toBe(true);
  });
  it("returns false for undefined, false, or other strings", () => {
    expect(isManagedOnly({})).toBe(false);
    expect(isManagedOnly({ CONTENT_ONLY_MANAGED: "false" })).toBe(false);
    expect(isManagedOnly({ CONTENT_ONLY_MANAGED: "0" })).toBe(false);
    expect(isManagedOnly({ CONTENT_ONLY_MANAGED: false })).toBe(false);
  });
});

describe("sanitizeAssetRelPath", () => {
  it("normalizes bare filenames to images/<name>", () => {
    expect(sanitizeAssetRelPath("diagram.png")).toBe("images/diagram.png");
    expect(sanitizeAssetRelPath("ecg.webp")).toBe("images/ecg.webp");
  });
  it("preserves explicit subpaths", () => {
    expect(sanitizeAssetRelPath("images/cardiology/ecg.png")).toBe("images/cardiology/ecg.png");
    expect(sanitizeAssetRelPath("assets/guide.pdf")).toBe("assets/guide.pdf");
  });
  it("rejects path traversal and invalid characters", () => {
    expect(sanitizeAssetRelPath("../secret.txt")).toBeNull();
    expect(sanitizeAssetRelPath("images/../../secret.txt")).toBeNull();
    expect(sanitizeAssetRelPath("images\\ecg.png")).toBeNull();
    expect(sanitizeAssetRelPath("")).toBeNull();
  });
});

describe("guessImageContentType", () => {
  it("maps extensions accurately", () => {
    expect(guessImageContentType("foo.png")).toBe("image/png");
    expect(guessImageContentType("foo.webp")).toBe("image/webp");
    expect(guessImageContentType("foo.jpg")).toBe("image/jpeg");
    expect(guessImageContentType("foo.jpeg")).toBe("image/jpeg");
    expect(guessImageContentType("foo.svg")).toBe("image/svg+xml");
    expect(guessImageContentType("foo.pdf")).toBe("application/pdf");
    expect(guessImageContentType("foo.md")).toBe("text/markdown; charset=utf-8");
    expect(guessImageContentType("foo.unknown")).toBe("application/octet-stream");
  });
});
