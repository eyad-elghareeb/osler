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

// Folders that hold binary assets (images, audio) next to a pack's JSON.
// They contain no content data files and must not be scanned as content nodes.
const ASSET_FOLDERS = new Set(["images", "assets"]);

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
 * A file holding both MCQ keys (questions/passages) and written `prompts`
 * is a `mixed` pack (MCQ + written).
 */
function inferTypeFromData(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    // Explicit type field takes priority
    if (data.type && typeof data.type === "string") return data.type;
    // Mixed pack: MCQ content (questions or passages) alongside written prompts
    const hasMcq =
      (Array.isArray(data.questions) && data.questions.length > 0) ||
      (Array.isArray(data.passages) && data.passages.length > 0);
    const hasWritten = Array.isArray(data.prompts) && data.prompts.length > 0;
    if (hasMcq && hasWritten) return "mixed";
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
 * Read display and study metadata from a pack's JSON files. Keeping this in
 * the manifest lets pack browsers render complete cards before the pack body
 * is requested for a study session.
 *
 * For OSCE packs we also collect a per-station summary (id, title, specialty,
 * difficulty, type, time) and derive tags/description from station fields, so
 * the OSCE lobby can render full pack cards from the manifest alone — without
 * fetching the heavy stations.json (patient profiles, rubrics, hidden info).
 */
function getPackMetadata(dirPath, fileNames) {
  const metadata = {
    questionCount: 0,
    itemCount: 0,
    description: undefined,
    lang: undefined,
    tags: new Set(),
    stationSummary: [],
    stationSpecialties: new Set(),
    stationDifficulties: new Set(),
    stationTypes: new Set(),
    stationTimeMax: 0,
  };

  for (const fileName of fileNames.filter((name) => name.endsWith(".json"))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dirPath, fileName), "utf-8"));
      const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
      if (!metadata.description && typeof meta.description === "string") metadata.description = meta.description;
      if (!metadata.lang && (meta.lang === "en" || meta.lang === "ar")) metadata.lang = meta.lang;

      for (const { key } of DATA_TYPE_KEYS) {
        const entries = Array.isArray(data[key]) ? data[key] : [];
        metadata.itemCount += entries.length;
        if (key === "passages") {
          metadata.questionCount += entries.reduce(
            (count, passage) => count + (Array.isArray(passage?.questions) ? passage.questions.length : 1),
            0,
          );
        } else {
          metadata.questionCount += entries.length;
        }
        for (const entry of entries) {
          if (!Array.isArray(entry?.tags)) continue;
          for (const tag of entry.tags) {
            if (typeof tag === "string" && tag.trim()) metadata.tags.add(tag.trim());
          }
        }

        // OSCE station summary — capture enough to render pack cards & a
        // station picker without loading the full stations.json. We strip
        // patient.hiddenProfile/rubric/questions which are session-only.
        if (key === "stations") {
          for (const station of entries) {
            if (!station || typeof station !== "object") continue;
            const id = typeof station.id === "string" ? station.id : undefined;
            const title = typeof station.title === "string" ? station.title : undefined;
            const specialty = typeof station.specialty === "string" ? station.specialty : undefined;
            const difficulty = typeof station.difficulty === "string" ? station.difficulty : undefined;
            const type = typeof station.type === "string" ? station.type : undefined;
            const time = typeof station.time === "number" ? station.time : undefined;
            if (specialty) metadata.stationSpecialties.add(specialty);
            if (difficulty) metadata.stationDifficulties.add(difficulty);
            if (type) metadata.stationTypes.add(type);
            if (typeof time === "number" && time > metadata.stationTimeMax) metadata.stationTimeMax = time;
            metadata.stationSummary.push({ id, title, specialty, difficulty, type, time });
          }
        }
      }
    } catch {
      // A malformed optional data file should not prevent other packs from publishing.
    }
  }

  // Non-JSON library resources are individual readable entries. Their file
  // names are already listed on the node, so count them without fetching any
  // content at runtime.
  metadata.itemCount += fileNames.filter((name) => !name.endsWith(".json")).length;

  // For OSCE packs with no explicit description, derive one from the station
  // specialties so the lobby card has useful context.
  if (!metadata.description && metadata.stationSummary.length > 0) {
    const specialties = Array.from(metadata.stationSpecialties).sort();
    if (specialties.length > 0) {
      metadata.description = `${metadata.stationSummary.length} station${metadata.stationSummary.length === 1 ? "" : "s"} · ${specialties.join(", ")}`;
    }
  }

  // OSCE packs don't carry entry.tags today — derive tag chips from
  // specialty/difficulty so the lobby card can show filters without loading
  // the pack body. Skip generic difficulties ("Easy/Medium/Hard") to keep
  // chips clinically meaningful, but always include specialties.
  if (metadata.stationSummary.length > 0) {
    for (const specialty of metadata.stationSpecialties) {
      if (typeof specialty === "string" && specialty.trim()) metadata.tags.add(specialty.trim());
    }
    for (const type of metadata.stationTypes) {
      if (typeof type === "string" && type.trim()) metadata.tags.add(type.trim());
    }
  }

  const result = {
    questionCount: metadata.questionCount,
    itemCount: metadata.itemCount,
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.lang ? { lang: metadata.lang } : {}),
    ...(metadata.tags.size > 0 ? { tags: Array.from(metadata.tags).sort() } : {}),
  };

  // Only attach station summary for actual OSCE packs (avoids bloating
  // quiz/bank/library manifests).
  if (metadata.stationSummary.length > 0) {
    result.stationSummary = metadata.stationSummary;
    result.stationSpecialties = Array.from(metadata.stationSpecialties).sort();
    result.stationDifficulties = Array.from(metadata.stationDifficulties).sort();
    result.stationTypes = Array.from(metadata.stationTypes).sort();
    if (metadata.stationTimeMax > 0) result.stationTimeMax = metadata.stationTimeMax;
  }

  return result;
}

function summarizeChildren(children) {
  // Roll up child metadata into a branch summary. For OSCE we also aggregate
  // station-level info so a parent folder (e.g. "Cardiology" with multiple
  // OSCE sub-packs) can render a card without descending into its children.
  const summary = {
    questionCount: 0,
    itemCount: 0,
    packCount: 0,
    stationSummary: [],
    stationSpecialties: new Set(),
    stationDifficulties: new Set(),
    stationTypes: new Set(),
    stationTimeMax: 0,
  };
  for (const child of children) {
    summary.questionCount += child.questionCount ?? 0;
    summary.itemCount += child.itemCount ?? 0;
    summary.packCount += child.packCount ?? 0;
    if (Array.isArray(child.stationSummary)) {
      for (const s of child.stationSummary) summary.stationSummary.push(s);
    }
    for (const sp of child.stationSpecialties ?? []) summary.stationSpecialties.add(sp);
    for (const d of child.stationDifficulties ?? []) summary.stationDifficulties.add(d);
    for (const tp of child.stationTypes ?? []) summary.stationTypes.add(tp);
    if (typeof child.stationTimeMax === "number" && child.stationTimeMax > summary.stationTimeMax) {
      summary.stationTimeMax = child.stationTimeMax;
    }
  }
  const out = {
    questionCount: summary.questionCount,
    itemCount: summary.itemCount,
    packCount: summary.packCount,
  };
  if (summary.stationSummary.length > 0) {
    out.stationSummary = summary.stationSummary;
    out.stationSpecialties = Array.from(summary.stationSpecialties).sort();
    out.stationDifficulties = Array.from(summary.stationDifficulties).sort();
    out.stationTypes = Array.from(summary.stationTypes).sort();
    if (summary.stationTimeMax > 0) out.stationTimeMax = summary.stationTimeMax;
  }
  return out;
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
 * Get list of data JSON filenames in a directory (excluding manifest and
 * article sidecar meta files).
 */
function getDataFileNames(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((e) => e.isFile() && (e.name.endsWith(".json") || e.name.endsWith(".md") || e.name.endsWith(".pdf") || e.name.endsWith(".html")) && e.name !== MANIFEST_NAME)
    .map((e) => e.name)
    .filter((name) => !isArticleMetaFile(name))
    .sort();
}

/** Sidecar metadata for library articles (`<article>.meta.json`) — never a
 *  content data file; the client merges it over frontmatter at load time. */
function isArticleMetaFile(name) {
  return /\.meta\.json$/i.test(name);
}

/**
 * Get list of binary asset filenames in a directory's `images` subfolder
 * (e.g. png/jpg/svg/gif/webp). Returned relative to the images/ folder so
 * the client can build precache URLs as <base>/images/<name>.
 */
function getImageFileNames(dirPath) {
  const imagesDir = path.join(dirPath, "images");
  if (!fs.existsSync(imagesDir) || !fs.statSync(imagesDir).isDirectory()) return [];
  return fs.readdirSync(imagesDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(png|jpe?g|svg|gif|webp|avif|bmp)$/i.test(e.name))
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

  const subdirs = entries.filter((e) => e.isDirectory() && !ASSET_FOLDERS.has(e.name));
  const dataFiles = entries.filter(
    (e) => e.isFile() && (e.name.endsWith(".json") || e.name.endsWith(".md") || e.name.endsWith(".pdf") || e.name.endsWith(".html")) && !isArticleMetaFile(e.name)
  );

  const nodes = [];

  for (const dir of subdirs) {
    const childPath = path.join(dirPath, dir.name);
    const childRelative = relativePath ? `${relativePath}/${dir.name}` : dir.name;

    const childEntries = fs.readdirSync(childPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && e.name !== MANIFEST_NAME);

    const grandSubdirs = childEntries.filter((e) => e.isDirectory() && !ASSET_FOLDERS.has(e.name));

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
        images: getImageFileNames(childPath),
        items: children,
        packCount: countLeaves(children),
        ...summarizeChildren(children),
      });
    } else {
      // Leaf node — has data files, no subfolders
      const type = parentType || inferTypeFromFolder(childPath) || "quiz";
      const uid = buildUid(type, childRelative.split("/"));
      const files = getDataFileNames(childPath);
      nodes.push({
        uid,
        title: dir.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        type,
        path: childRelative + "/",
        files,
        images: getImageFileNames(childPath),
        items: [],
        packCount: 1,
        ...getPackMetadata(childPath, files),
      });
    }
  }

  // If no subdirs but has data files at this level, make this folder a leaf node
  if (subdirs.length === 0 && dataFiles.length > 0 && relativePath) {
    const type = parentType || inferTypeFromFolder(dirPath) || "quiz";
    const uid = buildUid(type, relativePath.split("/"));
    const files = dataFiles.map((e) => e.name).sort();
    return [{
      uid,
      title: path.basename(dirPath).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      type,
      path: relativePath + "/",
      files,
      images: getImageFileNames(dirPath),
      items: [],
      packCount: 1,
      ...getPackMetadata(dirPath, files),
    }];
  }

  return nodes;
}

function generate() {
  const categories = fs.readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);

  // Content version stamp — bumped on every generator run so the client can
  // cache-bust manifest requests (mirrors the Worker's content-manifests/
  // version.json on cloud instances). Manifest reads go through
  // /osler-content/content-version.json first, then manifests via ?v=<stamp>.
  const version = `${Date.now()}`;

  for (const category of categories) {
    const categoryPath = path.join(CONTENT_DIR, category);
    const parentType = FOLDER_TYPE_MAP[category] || null; // null = auto-detect per folder

    const items = scanDirectory(categoryPath, "", parentType);

    // Derive manifest type: for mixed categories (qbank), use the most common type
    const manifestType = parentType || (items.length > 0 ? getDominantType(items) : "quiz");

    const manifest = {
      type: manifestType,
      items,
      version,
    };

    const manifestPath = path.join(categoryPath, MANIFEST_NAME);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(`✓ Generated ${category}/manifest.json (${countLeaves(items)} leaf items)`);
  }

  fs.writeFileSync(
    path.join(CONTENT_DIR, "content-version.json"),
    JSON.stringify({ version, updatedAt: Date.now() }, null, 2),
    "utf-8"
  );
  console.log(`✓ content-version.json (v${version})`);

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
