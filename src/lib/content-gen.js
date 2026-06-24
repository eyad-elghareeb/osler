import { getClient } from './gemini.js';

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
  outline: { tokensPerItem: 200 },
  extract: { tokensPerItem: 400 },
  convert: { tokensPerItem: 800 },
};

const DAILY_CAP = 20;
const MONTHLY_CAP = 200;

function loadCosts() {
  try {
    const raw = localStorage.getItem('osler_ai_costs');
    if (!raw) return { today: 0, month: 0, date: '', monthKey: '' };
    const c = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    const monthKey = today.slice(0, 7);
    if (c.date !== today) c.today = 0;
    if (c.monthKey !== monthKey) { c.today = 0; c.month = 0; }
    c.date = today;
    c.monthKey = monthKey;
    return c;
  } catch { return { today: 0, month: 0, date: '', monthKey: '' }; }
}

function saveCosts(c) {
  localStorage.setItem('osler_ai_costs', JSON.stringify(c));
}

function estimateCost(stage, itemCount) {
  const cfg = STAGE_COSTS[stage];
  if (!cfg) return 0;
  const tokens = cfg.tokensPerItem * itemCount;
  const rate = stage === 'convert' ? 0.50 / 1000 : 0.015 / 1000;
  return +(tokens * rate).toFixed(4);
}

function checkCap() {
  const c = loadCosts();
  if (c.today >= DAILY_CAP) throw new Error(`Daily AI cost cap reached ($${DAILY_CAP}). Reset tomorrow or adjust caps.`);
  if (c.month >= MONTHLY_CAP) throw new Error(`Monthly AI cost cap reached ($${MONTHLY_CAP}). Reset next month or adjust caps.`);
}

function addCost(stage, itemCount) {
  const cost = estimateCost(stage, itemCount);
  const c = loadCosts();
  c.today = +(c.today + cost).toFixed(4);
  c.month = +(c.month + cost).toFixed(4);
  saveCosts(c);
  return cost;
}

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

export async function generateContent(prompt, contentType, opts = {}) {
  const apiKey = opts.apiKey || (await import('./gemini.js')).readKey();
  if (!apiKey) throw new Error('Gemini API key not set. Configure it in Settings.');
  const client = getClient(apiKey);
  const cfg = TYPE_CONFIG[contentType];
  if (!cfg) throw new Error(`Unknown content type: ${contentType}. Must be one of: ${Object.keys(TYPE_CONFIG).join(', ')}`);
  const count = opts.count || 5;
  const stages = [];
  let outline = null;

  try { checkCap(); } catch (e) { throw e; }

  const cancelSignal = opts.cancelSignal || null;

  // Stage 1: NL → outline
  const outlinePrompt = `Create an outline for ${count} ${contentType} items on this topic: "${prompt}".
Generate exactly ${count} items. Return JSON with title, description, count=${count}, topics, difficulty, tags.`;
  const outlineText = await client.request(OUTLINE_SYSTEM, [{ parts: [{ text: outlinePrompt }] }], 'gemini-3.1-flash-lite', 0.3, cancelSignal);
  try {
    outline = JSON.parse(outlineText);
  } catch {
    const jsonMatch = outlineText.match(/\{[\s\S]*\}/);
    if (jsonMatch) outline = JSON.parse(jsonMatch[0]);
    else throw new Error('Failed to parse outline from Gemini response');
  }
  const itemCount = outline.count || count;
  stages.push({ name: 'outline', model: 'gemini-3.1-flash-lite', cost: addCost('outline', itemCount) });

  // Stage 2: outline → extracted fields
  const extractPrompt = `Generate ${itemCount} ${contentType} items for: ${outline.title}
Topics: ${(outline.topics || []).join(', ')}
Difficulty: ${outline.difficulty || 3}
Description: ${outline.description || prompt}

Return a JSON array of exactly ${itemCount} items. Each item should have fields for type "${contentType}":
${cfg.fields}

Make the content clinically accurate and educationally valuable.`;
  const extractText = await client.request(EXTRACT_SYSTEM, [{ parts: [{ text: extractPrompt }] }], 'gemini-3.1-flash-lite', 0.3, cancelSignal);
  let extractedItems;
  try {
    extractedItems = JSON.parse(extractText);
  } catch {
    const arrMatch = extractText.match(/\[[\s\S]*\]/);
    if (arrMatch) extractedItems = JSON.parse(arrMatch[0]);
    else throw new Error('Failed to parse extracted items from Gemini response');
  }
  if (!Array.isArray(extractedItems)) extractedItems = [extractedItems];
  stages.push({ name: 'extract', model: 'gemini-3.1-flash-lite', cost: addCost('extract', extractedItems.length) });

  // Stage 3: Conversion
  const now = new Date().toISOString();
  const convertSystem = CONVERT_SYSTEM_PREFIX + `The current date-time is ${now}. Use this for createdAt and updatedAt.`;
  const convertPrompt = `Convert these ${contentType} items into the final schema format. Title: "${outline.title}". Description: "${outline.description || prompt}".
Items to convert:
${JSON.stringify(extractedItems, null, 2)}

Return the complete ${contentType} content object matching the schema, with meta including uid (e.g. "gen_${contentType}_001"), title, description, and all items with unique IDs.`;
  const convertText = await client.request(convertSystem, [{ parts: [{ text: convertPrompt }] }], 'gemini-3.1-pro-preview', 0.2, cancelSignal);
  let finalContent;
  try {
    finalContent = JSON.parse(convertText);
  } catch {
    const objMatch = convertText.match(/\{[\s\S]*\}/);
    if (objMatch) finalContent = JSON.parse(objMatch[0]);
    else throw new Error('Failed to parse final content from Gemini response');
  }
  stages.push({ name: 'convert', model: 'gemini-3.1-pro-preview', cost: addCost('convert', itemCount) });

  // Quality gate
  const qualityScore = calcQuality(finalContent, contentType);
  finalContent.meta = finalContent.meta || {};
  finalContent.meta.aiQualityScore = qualityScore;
  finalContent.meta.aiGenerated = true;
  finalContent.meta.aiPrompts = [{ stage: 'user', text: prompt }];

  const needsReview = qualityScore < 0.7;
  if (needsReview) {
    finalContent.meta.aiQualityAlert = 'Needs Review';
  }

  const totalCost = stages.reduce((s, st) => s + st.cost, 0);

  return {
    content: finalContent,
    qualityScore,
    needsReview,
    cost: +totalCost.toFixed(4),
    stages,
    outline,
    itemCount,
  };
}

export function getAICosts() {
  return loadCosts();
}

export function resetAICosts() {
  saveCosts({ today: 0, month: 0, date: new Date().toISOString().slice(0, 10), monthKey: new Date().toISOString().slice(0, 7) });
}

export { TYPE_CONFIG, estimateCost, checkCap };
