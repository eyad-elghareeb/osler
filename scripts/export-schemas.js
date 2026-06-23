// Stub — real implementation lands in Phase 1.
// Copies src/schemas/*.json to .agents/context/
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join } from 'path';
const src = join(process.cwd(), 'src', 'schemas');
const dst = join(process.cwd(), '.agents', 'context');
if (!existsSync(src)) {
  console.log('export-schemas: no src/schemas/ yet, skipping');
  process.exit(0);
}
if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) {
  if (f.endsWith('.json')) copyFileSync(join(src, f), join(dst, f));
}
console.log('export-schemas: stub — copied schemas to .agents/context/');
