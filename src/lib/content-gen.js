import { getClient, MODELS } from './gemini.js';
import { get, put } from './storage.js';
import { validate } from './validate.js';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6.5 fixes applied here (issues #4, #5, #6 + medium cap-export):
//   #4  Quality gate now calls `validate(content)` and routes invalid output
//       to "Needs Review" — previously only the heuristic score was checked.
//   #5  Cost tracking migrated from `localStorage['osler_ai_costs']` to the
//       IndexedDB `settings` store (key `aiCosts`), per AGENTS.md localStorage
//       allow-list. All reads/writes are now async.
//   #6  Gemini model names sourced from `MODELS` in `./gemini.js` (single source
//       of truth) and requests go through `client.tryRequests` so model fallback
//       actually fires when a model is deprecated.
//   med `DAILY_CAP` and `MONTHLY_CAP` are now exported so `dashboard.js` can
//       reuse them instead of duplicating magic numbers.
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  quiz: {
    schema: 'quiz-v1.json',
    itemKey: 'questions',
    label: 'question',
    fields: 'question (clinical vignette), 4-6 MC options, correct index (0-based), explanation, difficulty (1-5), optional tags',
  },
  bank: {
    schema: 'bank-v1.json',
    itemKey: 'passages',
    label: 'passage',
    fields: 'content (clinical scenario text), questions (array of Q&A linked to this passage), each question has: question text, 4-6 options, correct index, explanation, difficulty',
  },
  flashcard: {
    schema: 'flashcard-v1.json',
    itemKey: 'cards',
    label: 'card',
    fields: 'front (question/term), back (answer/definition), optional tags, optional cloze deletion marker',
  },
  written: {
    schema: 'written-v1.json',
    itemKey: 'prompts',
    label: 'prompt',
    fields: 'prompt (essay/case question), rubric (list of grading criteria), wordLimit, optional tags',
  },
  osce: {
    schema: 'osce-v1.json',
    itemKey: 'stations',
    label: 'station',
    fields: 'scenario (clinical encounter description), redFlags (list of danger signs), differential (list of DDx), rubric (list of marking criteria)',
  },
};

const STAGE_COSTS = {
  outline: { tokensPerItem: 200, ratePer1k: 0.015 },
  extract: { tokensPerItem: 400, ratePer1k: 0.015 },
  convert: { tokensPerItem: 800, ratePer1k: 0.50 },
};

// Exported so the admin dashboard can render cap values without duplicating
// magic numbers (Phase 6.5 medium fix).
export const DAILY_CAP = 20;
export const MONTHLY_CAP = 200;

// Model selection: prefer Flash-Lite for cheap stages, Pro for the conversion
// stage. Pulled from `MODELS` (single source of truth in gemini.js) so adding
// or deprecating a model in one place propagates everywhere (Phase 6.5 fix #6).
function pickModel(predicate) {
  const entry = MODELS.find(m => predicate(m[0]));
  return entry ? entry[0] : MODELS[0][0];
}
const OUTLINE_MODEL = pickModel(name => name.includes('flash-lite'));
const EXTRACT_MODEL = OUTLINE_MODEL; // both cheap stages use Flash-Lite
const CONVERT_MODEL = pickModel(name => name.includes('pro'));

// ─── Cost tracking (IndexedDB `settings` store, key `aiCosts`) ───────────────

const COSTS_KEY = 'aiCosts';

function _freshCosts() {
  const today = new Date().toISOString().slice(0, 10);
  const monthKey = today.slice(0, 7);
  return { today: 0, month: 0, date: today, monthKey };
}

async function loadCosts() {
  try {
    const entry = await get('settings', COSTS_KEY);
    const c = entry?.value || _freshCosts();
    const today = new Date().toISOString().slice(0, 10);
    const monthKey = today.slice(0, 7);
    if (c.date !== today) c.today = 0;
    if (c.monthKey !== monthKey) { c.today = 0; c.month = 0; }
    c.date = today;
    c.monthKey = monthKey;
    return c;
  } catch (e) {
    console.warn('[content-gen] loadCosts failed, using fresh counters:', e);
    return _freshCosts();
  }
}

async function saveCosts(c) {
  try {
    await put('settings', { key: COSTS_KEY, value: c });
  } catch (e) {
    // Storage failure must not break generation, but the cost cap will
    // effectively reset on next successful write. Surface the warning.
    console.warn('[content-gen] saveCosts failed (cost tracking degraded):', e);
  }
}

export function estimateCost(stage, itemCount) {
  const cfg = STAGE_COSTS[stage];
  if (!cfg) return 0;
  const tokens = cfg.tokensPerItem * itemCount;
  return +((tokens * cfg.ratePer1k) / 1000).toFixed(4);
}

async function checkCap() {
  const c = await loadCosts();
  if (c.today >= DAILY_CAP) {
    throw new Error(`Daily AI cost cap reached ($${DAILY_CAP}). Reset tomorrow or adjust caps in content-gen.js.`);
  }
  if (c.month >= MONTHLY_CAP) {
    throw new Error(`Monthly AI cost cap reached ($${MONTHLY_CAP}). Reset next month or adjust caps in content-gen.js.`);
  }
}

async function addCost(stage, itemCount) {
  const cost = estimateCost(stage, itemCount);
  const c = await loadCosts();
  c.today = +(c.today + cost).toFixed(4);
  c.month = +(c.month + cost).toFixed(4);
  await saveCosts(c);
  return cost;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const OUTLINE_SYSTEM = `You are a medical education content planner. Given a user request, produce a JSON outline of the content to create.
Return ONLY valid JSON with this shape:
{
  "title": "content title",
  "description": "brief description",
  "count": <integer number of items>,
  "topics": ["topic 1", "topic 2", ...],
  "difficulty": <1-5>,
  "tags": ["tag1", "tag2"]
}`;

const EXTRACT_SYSTEM = `You are a medical education content extractor. Given an outline and a content type, produce structured field data for each item.
Return ONLY a JSON array of items. Each item's structure depends on the content type:
- quiz: { "question": "...", "options": ["A", "B", "C", "D", ...], "correct": <0-based index>, "explanation": "...", "difficulty": <1-5> }
- bank: { "content": "passage text", "questions": [{ "question": "...", "options": [...], "correct": <index>, "explanation": "...", "difficulty": <1-5> }] }
- flashcard: { "front": "...", "back": "...", "tags": [...] }
- written: { "prompt": "...", "rubric": ["criterion 1", ...], "wordLimit": <number> }
- osce: { "scenario": "...", "redFlags": ["..."], "differential": ["..."], "rubric": ["..."] }`;

const CONVERT_SYSTEM_PREFIX = `You are a medical education content formatter. Given structured item data and a content type schema, produce final JSON matching that schema.

Schema requirements per type:
- quiz: { "meta": { "uid", "title", "description", "schemaVersion": "1.0", "createdAt": "<ISO date>", "updatedAt": "<ISO date>" }, "type": "quiz", "questions": [{ "id": "<unique>", "question": "...", "options": [...], "correct": <int>, "explanation": "...", "difficulty": <int>, "tags": [...] }] }
- bank: { "meta": { ... }, "type": "bank", "passages": [{ "id": "<unique>", "content": "...", "questions": [{ "id": "...", "passageId": "...", "question": "...", "options": [...], "correct": <int>, "explanation": "...", "difficulty": <int>, "tags": [...] }] }] }
- flashcard: { "meta": { ... }, "type": "flashcard", "cards": [{ "id": "<unique>", "front": "...", "back": "...", "tags": [...] }] }
- written: { "meta": { ... }, "type": "written", "prompts": [{ "id": "<unique>", "prompt": "...", "rubric": [...], "wordLimit": <int> }] }
- osce: { "meta": { ... }, "type": "osce", "stations": [{ "id": "<unique>", "scenario": "...", "redFlags": [...], "differential": [...], "rubric": [...] }] }

Return ONLY valid JSON. Use a unique alphanumeric ID for each item (e.g. "q_001", "passage_01"). Use the current date-time in ISO format for createdAt and updatedAt.`;

// ─── Quality scoring ─────────────────────────────────────────────────────────

function calcQuality(content, contentType) {
  const cfg = TYPE_CONFIG[contentType];
  if (!cfg) return 0;
  const items = content[cfg.itemKey];
  if (!items || !items.length) return 0;
  let scores = 0;
  for (const item of items) {
    if (contentType === 'flashcard') {
      let s = 0;
      if (item.front && item.front.length >= 10) s += 0.4;
      if (item.back && item.back.length >= 20) s += 0.4;
      if (item.tags && item.tags.length) s += 0.2;
      scores += s;
    } else if (contentType === 'quiz') {
      let s = 0;
      if (item.question && item.question.length >= 30) s += 0.25;
      if (item.options && item.options.length >= 4) s += 0.25;
      else if (item.options && item.options.length >= 2) s += 0.1;
      if (item.explanation && item.explanation.length >= 30) s += 0.35;
      if (item.difficulty && item.difficulty >= 1 && item.difficulty <= 5) s += 0.15;
      scores += s;
    } else if (contentType === 'bank') {
      let s = 0;
      if (item.content && item.content.length >= 80) s += 0.3;
      if (item.questions && item.questions.length) {
        s += 0.3;
        for (const q of item.questions) {
          if (q.options && q.options.length >= 4) s += 0.2;
          if (q.explanation && q.explanation.length >= 30) s += 0.2;
        }
      }
      scores += Math.min(s, 1);
    } else if (contentType === 'written') {
      let s = 0;
      if (item.prompt && item.prompt.length >= 40) s += 0.5;
      if (item.rubric && item.rubric.length >= 2) s += 0.3;
      if (item.wordLimit) s += 0.2;
      scores += s;
    } else if (contentType === 'osce') {
      let s = 0;
      if (item.scenario && item.scenario.length >= 60) s += 0.4;
      if (item.redFlags && item.redFlags.length) s += 0.2;
      if (item.differential && item.differential.length) s += 0.2;
      if (item.rubric && item.rubric.length) s += 0.2;
      scores += s;
    }
  }
  return +(scores / items.length).toFixed(2);
}

// ─── JSON extraction helper ──────────────────────────────────────────────────

function parseJsonLoose(text, arrayMode = false) {
  try {
    return JSON.parse(text);
  } catch {
    const m = arrayMode
      ? text.match(/\[[\s\S]*\]/)
      : text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`Failed to parse JSON from Gemini response (arrayMode=${arrayMode})`);
  }
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

export async function generateContent(prompt, contentType, opts = {}) {
  const apiKey = opts.apiKey || (await import('./gemini.js')).readKey();
  if (!apiKey) throw new Error('Gemini API key not set. Configure it in Settings.');
  const client = getClient(apiKey);
  const cfg = TYPE_CONFIG[contentType];
  if (!cfg) {
    throw new Error(`Unknown content type: ${contentType}. Must be one of: ${Object.keys(TYPE_CONFIG).join(', ')}`);
  }
  const count = opts.count || 5;
  const stages = [];
  let outline = null;

  await checkCap();

  const cancelSignal = opts.cancelSignal || null;

  // Stage 1: NL → outline. Prompt includes the schema reference per P6.1.
  const outlinePrompt = `Create an outline for ${count} ${contentType} items on this topic: "${prompt}".
Generate exactly ${count} items. Return JSON with title, description, count=${count}, topics, difficulty, tags.
The content will be validated against the ${cfg.schema} JSON Schema.`;
  const outlineText = await client.tryRequests(
    OUTLINE_SYSTEM,
    [{ parts: [{ text: outlinePrompt }] }],
    OUTLINE_MODEL,
    cancelSignal,
    0.3
  );
  outline = parseJsonLoose(outlineText, false);
  const itemCount = outline.count || count;
  stages.push({ name: 'outline', model: OUTLINE_MODEL, cost: await addCost('outline', itemCount) });

  // Stage 2: outline → extracted fields
  const extractPrompt = `Generate ${itemCount} ${contentType} items for: ${outline.title}
Topics: ${(outline.topics || []).join(', ')}
Difficulty: ${outline.difficulty || 3}
Description: ${outline.description || prompt}

Return a JSON array of exactly ${itemCount} items. Each item should have fields for type "${contentType}":
${cfg.fields}

Make the content clinically accurate and educationally valuable.`;
  const extractText = await client.tryRequests(
    EXTRACT_SYSTEM,
    [{ parts: [{ text: extractPrompt }] }],
    EXTRACT_MODEL,
    cancelSignal,
    0.3
  );
  let extractedItems = parseJsonLoose(extractText, true);
  if (!Array.isArray(extractedItems)) extractedItems = [extractedItems];
  stages.push({ name: 'extract', model: EXTRACT_MODEL, cost: await addCost('extract', extractedItems.length) });

  // Stage 3: Conversion (Pro model)
  const now = new Date().toISOString();
  const convertSystem = CONVERT_SYSTEM_PREFIX + `\nThe current date-time is ${now}. Use this for createdAt and updatedAt.`;
  const convertPrompt = `Convert these ${contentType} items into the final schema format. Title: "${outline.title}". Description: "${outline.description || prompt}".
Items to convert:
${JSON.stringify(extractedItems, null, 2)}

Return the complete ${contentType} content object matching the schema, with meta including uid (e.g. "gen_${contentType}_001"), title, description, and all items with unique IDs.`;
  const convertText = await client.tryRequests(
    convertSystem,
    [{ parts: [{ text: convertPrompt }] }],
    CONVERT_MODEL,
    cancelSignal,
    0.2
  );
  let finalContent = parseJsonLoose(convertText, false);
  stages.push({ name: 'convert', model: CONVERT_MODEL, cost: await addCost('convert', itemCount) });

  // ─── Quality gate (Phase 6.5 fix #4): validate + heuristic score ───────────
  const qualityScore = calcQuality(finalContent, contentType);
  const { valid: schemaValid, errors: validationErrors } = validate(finalContent);
  finalContent.meta = finalContent.meta || {};
  finalContent.meta.aiQualityScore = qualityScore;
  finalContent.meta.aiGenerated = true;
  finalContent.meta.aiPrompts = [{ stage: 'user', text: prompt }];

  // Needs Review if EITHER the schema rejects the content OR the heuristic
  // score falls below 0.7. Previously only the heuristic was checked, so
  // invalid output (e.g. out-of-range `correct` index) could be approved.
  const needsReview = !schemaValid || qualityScore < 0.7;
  if (needsReview) {
    finalContent.meta.aiQualityAlert = 'Needs Review';
    if (!schemaValid) {
      finalContent.meta.aiValidationErrors = validationErrors;
    }
  }

  const totalCost = stages.reduce((s, st) => s + st.cost, 0);

  return {
    content: finalContent,
    qualityScore,
    needsReview,
    schemaValid,
    validationErrors: schemaValid ? [] : validationErrors,
    cost: +totalCost.toFixed(4),
    stages,
    outline,
    itemCount,
  };
}

export async function getAICosts() {
  return loadCosts();
}

export async function resetAICosts() {
  await saveCosts(_freshCosts());
}

export { TYPE_CONFIG, estimateCost, checkCap };
