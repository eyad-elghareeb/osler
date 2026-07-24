#!/usr/bin/env node
/**
 * Upload local content packs from public/osler-content/ to the Cloudflare Worker
 * R2-backed admin content API. Creates each pack as a published content object.
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

function readManifest(category) {
  const manifestPath = path.join(CONTENT_DIR, category, "manifest.json");
  if (!fs.existsSync(manifestPath)) return [];
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8")).items || [];
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

function mergeJsonFiles(dir, files) {
  const merged = {};
  for (const file of files) {
    const raw = JSON.parse(readFile(path.join(dir, file)));
    for (const [key, val] of Object.entries(raw)) {
      if (Array.isArray(val)) {
        if (!merged[key]) merged[key] = [];
        merged[key].push(...val);
      } else if (typeof val === "string") {
        merged[key] = val;
      }
    }
  }
  return merged;
}

function buildContentBody(node, category) {
  const dir = path.join(category, node.path);
  const type = node.type;

  if (type === "library") {
    // Library: each .md file is a separate content object
    return null; // handled specially
  }

  const data = mergeJsonFiles(dir, node.files);
  const body = {
    meta: { uid: node.uid, title: node.title, lang: node.lang || "en" },
    type,
  };

  // Copy array keys from merged data
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) body[key] = val;
    else if (typeof val === "string") body[key] = val;
  }

  return body;
}

async function uploadPack(title, contentType, body, lang = "en") {
  const created = await api("POST", "/v1/admin/content", {
    contentType,
    title,
    language: lang,
    content: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (!created?.id) return null;

  // For non-library types, overwrite the draft with the full body
  if (typeof body !== "string") {
    await api("PUT", `/v1/admin/content/${created.id}/draft`, JSON.stringify(body), true);
  }

  // Direct publish (skip review)
  const published = await api("POST", `/v1/admin/content/${created.id}/publish`);
  return created.id;
}

async function processLibrary(node, category) {
  const dir = path.join(category, node.path);
  const ids = [];

  for (const file of node.files) {
    if (!file.endsWith(".md")) continue;
    const md = readFile(path.join(dir, file));
    const titleMatch = md.match(/^title:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].replace(/['"]/g, "").trim() : file.replace(".md", "");

    const id = await uploadPack(title, "library", md, node.lang || "en");
    if (id) ids.push(id);
  }
  return ids;
}

async function main() {
  await login();

  const categories = ["qbank", "flashcard", "osce", "library", "videos"];
  let total = 0;

  for (const category of categories) {
    const items = readManifest(category);
    if (!items.length) { console.log(`\n📁 ${category}: no items`); continue; }

    const leaves = flattenLeaves(items);
    console.log(`\n📁 ${category}: ${leaves.length} pack(s)`);

    for (const leaf of leaves) {
      const lang = leaf.lang || "en";
      let ids = [];

      if (leaf.type === "library") {
        ids = await processLibrary(leaf, category);
      } else {
        const body = buildContentBody(leaf, category);
        if (!body) continue;
        const id = await uploadPack(leaf.title, leaf.type, body, lang);
        if (id) ids.push(id);
      }

      if (ids.length) {
        console.log(`  ✓ ${leaf.title} (${leaf.type}) → ${ids.join(", ")}`);
        total += ids.length;
      }
    }
  }

  console.log(`\n✨ Uploaded ${total} content object(s) to R2`);
}

main().catch(console.error);
