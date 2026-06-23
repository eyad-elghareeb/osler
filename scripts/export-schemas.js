import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join } from 'path';

const src = join(process.cwd(), 'src', 'schemas');
const dst = join(process.cwd(), '.agents', 'context');

if (!existsSync(src)) {
  console.log('export-schemas: no src/schemas/ directory found');
  process.exit(0);
}

mkdirSync(dst, { recursive: true });

const files = readdirSync(src).filter(file => file.endsWith('.json'));

for (const file of files) {
  copyFileSync(join(src, file), join(dst, file));
}

console.log(`export-schemas: copied ${files.length} schema files to .agents/context/`);
