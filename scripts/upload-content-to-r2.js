#!/usr/bin/env node
/**
 * Upload local content packs from public/osler-content/ to R2 via the
 * Cloudflare Worker's admin API. Stores category manifests and individual
 * data files so the user-facing app can fetch them directly.
 *
 * R2 key structure:
 *   content-manifests/<category>/manifest.json   — category manifest
 *   content-files/<category>/<path>/<file>        — individual data/image files
 *
 * Usage: node scripts/upload-content-to-r2.js [api_url] [username] [password]
 */

const fs = require("fs");
const path = require("path");

const API = process.argv[2] || "http://localhost:8787";
const USERNAME = process.argv[3] || "admin";
const PASSWORD = process.argv[4] || "123";
const CONTENT_DIR = path.join(__dirname, "..", "public", "osler-content");

let TOKEN = null;

async function api(method, endpoint, body, raw = false) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  if (!raw && body) headers["Content-Type"] = "application/json";
  else if (raw && body) headers["Content-Type"] = "text/plain";

  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`  ✗ ${method} ${endpoint} → ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }
  try { return JSON.parse(text); } catch { return text; }
}

async function login() {
  const data = await api("POST", "/v1/auth/login", { identifier: USERNAME, password: PASSWORD });
  if (!data?.token) { console.error("Login failed"); process.exit(1); }
  TOKEN = data.token;
  console.log(`Logged in as ${data.user.username} (${data.user.role})`);
}

async function uploadFile(key, content) {
  return api("POST", "/v1/admin/content/upload-file", { key, body: content });
}

function readManifest(category) {
  const manifestPath = path.join(CONTENT_DIR, category, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
}

function flattenLeaves(nodes, parentLang = "en") {
  const leaves = [];
  for (const node of nodes) {
    const lang = node.lang || parentLang;
    if (node.items && node.items.length > 0) {
      leaves.push(...flattenLeaves(node.items, lang));
    } else if (node.files && node.files.length > 0) {
      leaves.push({ ...node, lang });
    }
  }
  return leaves;
}

function readFile(filePath) {
  return fs.readFileSync(path.join(CONTENT_DIR, filePath), "utf-8");
}

function readBinary(filePath) {
  return fs.readFileSync(path.join(CONTENT_DIR, filePath));
}

async function main() {
  await login();

  const categories = ["qbank", "flashcard", "osce", "library", "videos"];
  let totalFiles = 0;

  for (const category of categories) {
    const manifest = readManifest(category);
    if (!manifest) { console.log(`\n📁 ${category}: no manifest`); continue; }

    console.log(`\n📁 ${category}`);

    // 1. Upload the manifest
    const manifestKey = `content-manifests/${category}/manifest.json`;
    await uploadFile(manifestKey, JSON.stringify(manifest, null, 2));
    console.log(`  ✓ ${manifestKey}`);
    totalFiles++;

    // 2. Upload individual data files for each leaf node
    const leaves = flattenLeaves(manifest.items);
    for (const leaf of leaves) {
      for (const file of leaf.files ?? []) {
        const localPath = path.join(category, leaf.path, file);
        const r2Key = `content-files/${category}/${leaf.path}/${file}`;
        try {
          const content = readFile(localPath);
          await uploadFile(r2Key, content);
          totalFiles++;
        } catch (e) {
          console.error(`  ✗ ${r2Key}: ${e.message}`);
        }
      }
      // Upload images if present
      for (const img of leaf.images ?? []) {
        const localPath = path.join(category, leaf.path, "images", img);
        // `leaf.path` ends with "/" so we can concatenate directly. Use
        // path.join for clarity on local FS, but keep the slash for the R2 key.
        const imgR2Path = leaf.path.endsWith("/")
          ? `${leaf.path}images/${img}`
          : `${leaf.path}/images/${img}`;
        const r2Key = `content-files/${category}/${imgR2Path}`;
        try {
          const content = readBinary(localPath);
          // Pick a sensible content-type from the extension so the Worker's
          // public serving endpoint returns the right Content-Type header.
          const ext = path.extname(img).toLowerCase();
          const mime =
            ext === ".svg" ? "image/svg+xml"
            : ext === ".png" ? "image/png"
            : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
            : ext === ".gif" ? "image/gif"
            : ext === ".webp" ? "image/webp"
            : ext === ".avif" ? "image/avif"
            : ext === ".mp3" || ext === ".m4a" ? "audio/mpeg"
            : ext === ".mp4" ? "video/mp4"
            : "application/octet-stream";
          const b64 = content.toString("base64");
          await api("POST", "/v1/admin/content/upload-file", {
            key: r2Key,
            body: `data:${mime};base64,${b64}`,
          });
          totalFiles++;
        } catch (e) {
          console.error(`  ✗ ${r2Key}: ${e.message}`);
        }
      }
      console.log(`  ✓ ${leaf.title} (${leaf.files?.length ?? 0} files)`);
    }
  }

  console.log(`\n✨ Uploaded ${totalFiles} file(s) to R2`);
}

main().catch(console.error);
