/**
 * Osler content manifest generator.
 *
 * Walks public/osler-content/ category folders (flashcard, qbank, osce, library)
 * and generates a manifest.json in each category root describing the full
 * folder hierarchy. Each manifest is a recursive tree of ContentTreeNode objects.
 *
 * Usage: node scripts/generate-content-manifests.js
 *
 * Folder → EngineType mapping:
 *   flashcard/ → "flashcard"
 *   osce/      → "osce"
 *   library/   → "library"
 *   qbank/     → auto-detected from data file keys
 */

const fs = require("fs");
const path = require("path");

const CONTENT_DIR = path.resolve(__dirname, "..", "public", "osler-content");
const MANIFEST_NAME = "manifest.json";

// Direct folder name → type mapping
const FOLDER_TYPE_MAP = {
  flashcard: "flashcard",
  osce: "osce",
  library: "library",
  videos: "video",
};

// Data key → EngineType inference for qbank
const DATA_TYPE_KEYS = [
  { key: "stations", type: "osce" },
  { key: "passages", type: "bank" },
  { key: "prompts", type: "written" },
  { key: "questions", type: "quiz" },
  { key: "cards", type: "flashcard" },
  { key: "videos", type: "video" },
];

/**
 * Read the engine type from a data JSON file.
 * First checks for an explicit `type` field at the top level.
 * Falls back to inferring from data keys (questions → quiz, etc.).
 */
function inferTypeFromData(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    // Explicit type field takes priority
    if (data.type && typeof data.type === "string") return data.type;
    // Fallback: infer from data keys
    for (const { key, type } of DATA_TYPE_KEYS) {
      if (Array.isArray(data[key]) && data[key].length > 0) return type;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/**
 * Infer engine type from a folder by reading its .json data files.
 */
function inferTypeFromFolder(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== MANIFEST_NAME) {
      const type = inferTypeFromData(path.join(dirPath, entry.name));
      if (type) return type;
    }
  }
  return null;
}

/**
 * Sanitize a folder name to create a URL-safe path segment.
 */
function sanitize(name) {
  if (typeof name !== "string") return "";
  return name.replace(/[\s]+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || name;
}

/**
 * Build a uid from the category type and the relative path segments.
 */
function buildUid(type, segments) {
  const parts = [type, ...(Array.isArray(segments) ? segments : [segments]).map(sanitize)].filter(Boolean);
  return parts.join("-");
}

/**
 * Get list of data JSON filenames in a directory (excluding manifest).
 */
function getDataFileNames(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((e) => e.isFile() && (e.name.endsWith(".json") || e.name.endsWith(".md") || e.name.endsWith(".pdf") || e.name.endsWith(".html")) && e.name !== MANIFEST_NAME)
    .map((e) => e.name)
    .sort();
}

/**
 * Recursively scan a directory and build content tree nodes.
 */
function scanDirectory(dirPath, relativePath, parentType) {
  if (!fs.existsSync(dirPath)) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && e.name !== MANIFEST_NAME)
    .sort((a, b) => a.name.localeCompare(b.name));

  const subdirs = entries.filter((e) => e.isDirectory());
  const dataFiles = entries.filter(
    (e) => e.isFile() && (e.name.endsWith(".json") || e.name.endsWith(".md") || e.name.endsWith(".pdf") || e.name.endsWith(".html"))
  );

  const nodes = [];

  for (const dir of subdirs) {
    const childPath = path.join(dirPath, dir.name);
    const childRelative = relativePath ? `${relativePath}/${dir.name}` : dir.name;

    const childEntries = fs.readdirSync(childPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && e.name !== MANIFEST_NAME);

    const grandSubdirs = childEntries.filter((e) => e.isDirectory());

    if (grandSubdirs.length > 0) {
      // Branch node — has subfolders, recurse
      const children = scanDirectory(childPath, childRelative, parentType);
      const type = parentType || inferTypeFromFolder(childPath) || "quiz";
      const uid = buildUid(type, childRelative.split("/"));
      nodes.push({
        uid,
        title: dir.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        type,
        path: childRelative + "/",
        files: getDataFileNames(childPath),
        items: children,
      });
    } else {
      // Leaf node — has data files, no subfolders
      const type = parentType || inferTypeFromFolder(childPath) || "quiz";
      const uid = buildUid(type, childRelative.split("/"));
      nodes.push({
        uid,
        title: dir.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        type,
        path: childRelative + "/",
        files: getDataFileNames(childPath),
        items: [],
      });
    }
  }

  // If no subdirs but has data files at this level, make this folder a leaf node
  if (subdirs.length === 0 && dataFiles.length > 0 && relativePath) {
    const type = parentType || inferTypeFromFolder(dirPath) || "quiz";
    const uid = buildUid(type, relativePath.split("/"));
    return [{
      uid,
      title: path.basename(dirPath).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      type,
      path: relativePath + "/",
      files: dataFiles.map((e) => e.name).sort(),
      items: [],
    }];
  }

  return nodes;
}

function generate() {
  const categories = fs.readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);

  for (const category of categories) {
    const categoryPath = path.join(CONTENT_DIR, category);
    const parentType = FOLDER_TYPE_MAP[category] || null; // null = auto-detect per folder

    const items = scanDirectory(categoryPath, "", parentType);

    // Derive manifest type: for mixed categories (qbank), use the most common type
    const manifestType = parentType || (items.length > 0 ? getDominantType(items) : "quiz");

    const manifest = {
      type: manifestType,
      items,
    };

    const manifestPath = path.join(categoryPath, MANIFEST_NAME);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(`✓ Generated ${category}/manifest.json (${countLeaves(items)} leaf items)`);
  }

  console.log("\nDone. Run this script after adding or removing content folders.");
}

/**
 * Get the most common type across all leaf nodes in a tree.
 */
function getDominantType(items) {
  const counts = {};
  function walk(list) {
    for (const item of list) {
      if (item.items && item.items.length > 0) {
        walk(item.items);
      } else {
        counts[item.type] = (counts[item.type] || 0) + 1;
      }
    }
  }
  walk(items);
  const entries = Object.entries(counts);
  if (entries.length === 0) return "quiz";
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function countLeaves(items) {
  let count = 0;
  for (const item of items) {
    if (item.items.length === 0) count++;
    else count += countLeaves(item.items);
  }
  return count;
}

generate();
