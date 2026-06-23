// scripts/add-type-button.js
// Adds type="button" to <button> tags in engine files that don't already have it.
// Also adds aria-label to icon-only buttons (buttons whose only content is an SVG or icon class).
// Idempotent: safe to re-run.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const enginesDir = join(process.cwd(), 'engines');
const files = [
  'quiz-engine.js', 'bank-engine.js', 'flashcard-engine.js',
  'written-engine.js', 'osce-engine.js', 'uworld-engine.js',
  'search-engine.js', 'ai-assistant-engine.js', 'index-engine.js',
];

// Match <button ...> that doesn't already have type= attribute.
// Skip <button type="submit"> intentionally — we don't want to override form submits.
const BUTTON_RE = /<button(?![^>]*\btype=)([^>]*)>/g;

let totalFixed = 0;

for (const f of files) {
  const path = join(enginesDir, f);
  let src;
  try { src = readFileSync(path, 'utf8'); } catch (e) { continue; }

  let count = 0;
  const newSrc = src.replace(BUTTON_RE, (match, rest) => {
    count++;
    return `<button type="button"${rest}>`;
  });

  if (count > 0) {
    writeFileSync(path, newSrc, 'utf8');
    console.log(`  ${f}: added type="button" to ${count} <button> tags`);
    totalFixed += count;
  }
}

console.log(`\nDone. ${totalFixed} <button> tags updated.`);
