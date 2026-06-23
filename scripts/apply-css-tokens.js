// scripts/apply-css-tokens.js
// Replaces common hardcoded CSS values with var() token references
// in src/css/*.css files. Conservative: only replaces values that
// EXACTLY match a token definition in shared.css.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const cssDir = join(process.cwd(), 'src', 'css');
const files = [
  'shared.css', 'quiz-engine.css', 'bank-engine.css',
  'flashcard-engine.css', 'written-engine.css', 'osce-engine.css',
  'uworld-engine.css', 'index-engine.css', 'search-engine.css',
  'ai-assistant-engine.css',
];

// Token mapping. Only replace when the value EXACTLY matches (with optional units).
// This avoids replacing values like `padding: 7px` that don't have a token.
const replacements = [
  // Border radius
  { pattern: /border-radius:\s*6px/g, replacement: 'border-radius: var(--radius-sm)' },
  { pattern: /border-radius:\s*10px/g, replacement: 'border-radius: var(--radius-md)' },
  { pattern: /border-radius:\s*16px/g, replacement: 'border-radius: var(--radius-lg)' },
  { pattern: /border-radius:\s*24px/g, replacement: 'border-radius: var(--radius-xl)' },

  // Spacing (padding) — only whole values, not compound like `padding: 5px 7px`
  { pattern: /padding:\s*4px(?!\s*[%a-zA-Z0-9])/g, replacement: 'padding: var(--space-1)' },
  { pattern: /padding:\s*8px(?!\s*[%a-zA-Z0-9])/g, replacement: 'padding: var(--space-2)' },
  { pattern: /padding:\s*12px(?!\s*[%a-zA-Z0-9])/g, replacement: 'padding: var(--space-3)' },
  { pattern: /padding:\s*16px(?!\s*[%a-zA-Z0-9])/g, replacement: 'padding: var(--space-4)' },
  { pattern: /padding:\s*24px(?!\s*[%a-zA-Z0-9])/g, replacement: 'padding: var(--space-5)' },
  { pattern: /padding:\s*32px(?!\s*[%a-zA-Z0-9])/g, replacement: 'padding: var(--space-6)' },

  // Transition
  { pattern: /transition:\s*0\.2s\s+ease(-out)?(?!\s*[,)])/g, replacement: 'transition: var(--transition-normal)' },
  { pattern: /transition:\s*0\.15s\s+ease(-out)?(?!\s*[,)])/g, replacement: 'transition: var(--transition-fast)' },
];

let totalReplacements = 0;

for (const f of files) {
  const path = join(cssDir, f);
  let src;
  try { src = readFileSync(path, 'utf8'); } catch (e) { continue; }

  let fileCount = 0;
  for (const { pattern, replacement } of replacements) {
    src = src.replace(pattern, () => { fileCount++; return replacement; });
  }

  if (fileCount > 0) {
    writeFileSync(path, src, 'utf8');
    console.log(`  ${f}: ${fileCount} replacements`);
    totalReplacements += fileCount;
  }
}

console.log(`\nDone. ${totalReplacements} CSS values tokenized.`);
