import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENGINES_DIR = join(ROOT, 'engines');
const DIST_DIR = join(ROOT, 'dist');
const ASSETS_DIR = join(ROOT, 'assets');
const SRC_CSS_DIR = join(ROOT, 'src', 'css');
const SRC_LIB_DIR = join(ROOT, 'src', 'lib');
const SRC_SCHEMAS_DIR = join(ROOT, 'src', 'schemas');
const CONTENT_DIR = join(ROOT, 'content');

if (!existsSync(DIST_DIR)) mkdirSync(DIST_DIR, { recursive: true });

function copyDir(src, dst, filter) {
  if (!existsSync(src)) return 0;
  let count = 0;
  const items = readdirSync(src);
  items.forEach(item => {
    const srcPath = join(src, item);
    const dstPath = join(dst, item);
    if (statSync(srcPath).isDirectory()) {
      count += copyDir(srcPath, dstPath, filter);
      return;
    }
    if (filter && !filter(item)) return;
    if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
    copyFileSync(srcPath, dstPath);
    count++;
  });
  return count;
}

async function buildEngines() {
  const engineFiles = readdirSync(ENGINES_DIR).filter(f => f.endsWith('.js'));
  const results = await Promise.allSettled(engineFiles.map(async (file) => {
    const src = join(ENGINES_DIR, file);
    const dst = join(DIST_DIR, file);
    await build({
      entryPoints: [src],
      outfile: dst,
      bundle: false,
      format: 'iife',
      target: 'es2020',
      allowOverwrite: true,
    });
    return file;
  }));

  for (const r of results) {
    if (r.status === 'fulfilled') {
      console.log(`Built ${r.value} → dist/`);
    } else {
      console.error(`Failed: ${r.reason}`);
    }
  }
  return results.filter(r => r.status === 'fulfilled').length;
}

async function buildCss() {
  const cssFiles = readdirSync(SRC_CSS_DIR).filter(f => f.endsWith('.css'));
  const results = await Promise.allSettled(cssFiles.map(async (file) => {
    const src = join(SRC_CSS_DIR, file);
    const dst = join(DIST_DIR, file);
    await build({
      entryPoints: [src],
      outfile: dst,
      allowOverwrite: true,
    });
    return file;
  }));

  for (const r of results) {
    if (r.status === 'fulfilled') {
      console.log(`Built ${r.value} → dist/`);
    } else {
      console.error(`Failed: ${r.reason}`);
    }
  }
  return results.filter(r => r.status === 'fulfilled').length;
}

async function runBuild() {
  const engineCount = await buildEngines();
  console.log(`Processed ${engineCount} engine files via esbuild`);

  const cssCount = await buildCss();
  console.log(`Processed ${cssCount} CSS files via esbuild`);

  const assetsDist = join(DIST_DIR, 'assets');
  const assetCount = copyDir(ASSETS_DIR, assetsDist);
  console.log(`Copied ${assetCount} asset files → dist/assets/`);

  const libCount = copyDir(SRC_LIB_DIR, join(DIST_DIR, 'src', 'lib'), file => file.endsWith('.js'));
  const schemaCount = copyDir(SRC_SCHEMAS_DIR, join(DIST_DIR, 'src', 'schemas'), file => file.endsWith('.json'));
  const contentCount = copyDir(CONTENT_DIR, join(DIST_DIR, 'content'), file => file.endsWith('.json'));
  console.log(`Copied ${libCount} lib files → dist/src/lib/`);
  console.log(`Copied ${schemaCount} schema files → dist/src/schemas/`);
  console.log(`Copied ${contentCount} content files → dist/content/`);

  const rootFiles = ['manifest.webmanifest', 'sw.js', 'player.html'];
  for (const f of rootFiles) {
    const src = join(ROOT, f);
    const dst = join(DIST_DIR, f);
    if (existsSync(src)) {
      copyFileSync(src, dst);
      console.log(`Copied ${f} → dist/`);
    }
  }

  console.log('Build complete.');
}

runBuild().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
