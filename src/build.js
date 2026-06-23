import { copyFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENGINES_DIR = join(ROOT, 'engines');
const DIST_DIR = join(ROOT, 'dist');
const ASSETS_DIR = join(ROOT, 'assets');
const SRC_CSS_DIR = join(ROOT, 'src', 'css');
const SRC_LIB_DIR = join(ROOT, 'src', 'lib');

if (!existsSync(DIST_DIR)) mkdirSync(DIST_DIR, { recursive: true });

function copyDir(src, dst, filter) {
  if (!existsSync(src)) return 0;
  let count = 0;
  const items = readdirSync(src);
  items.forEach(item => {
    const srcPath = join(src, item);
    const dstPath = join(dst, item);
    if (statSync(srcPath).isDirectory()) return;
    if (filter && !filter(item)) return;
    if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
    copyFileSync(srcPath, dstPath);
    count++;
  });
  return count;
}

function build() {
  // Copy all engine files (they're self-contained IIFE browser scripts)
  const engineCount = copyDir(ENGINES_DIR, DIST_DIR);
  console.log(`Copied ${engineCount} engine files → dist/`);

  // Copy CSS files from src/css/
  const cssCount = copyDir(SRC_CSS_DIR, DIST_DIR, f => f.endsWith('.css'));
  console.log(`Copied ${cssCount} CSS files → dist/`);

  // Copy assets (icons, favicon)
  const assetsDist = join(DIST_DIR, 'assets');
  const assetCount = copyDir(ASSETS_DIR, assetsDist);
  console.log(`Copied ${assetCount} asset files → dist/assets/`);

  console.log('Build complete.');
}

build();
