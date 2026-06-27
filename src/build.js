import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, existsSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENGINES_DIR = join(ROOT, 'engines');
const DIST_DIR = join(ROOT, 'dist');
const ASSETS_DIR = join(ROOT, 'assets');
const SRC_CSS_DIR = join(ROOT, 'src', 'css');
const SRC_LIB_DIR = join(ROOT, 'src', 'lib');
const SRC_I18N_DIR = join(ROOT, 'src', 'i18n');
const SRC_SCHEMAS_DIR = join(ROOT, 'src', 'schemas');
const HUB_DIR = join(ROOT, 'hub');
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
      format: 'esm',
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

async function buildPlayerMain() {
  const src = join(ROOT, 'src', 'player-main.js');
  const dst = join(DIST_DIR, 'player-main.js');
  await build({
    entryPoints: [src],
    outfile: dst,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    allowOverwrite: true,
  });
  console.log('Built player-main.js → dist/ (bundled with deps)');
}

async function runBuild() {
  const engineCount = await buildEngines();
  console.log(`Processed ${engineCount} engine files via esbuild`);

  const cssCount = await buildCss();
  console.log(`Processed ${cssCount} CSS files via esbuild`);

  const assetsDist = join(DIST_DIR, 'assets');
  const assetCount = copyDir(ASSETS_DIR, assetsDist);
  console.log(`Copied ${assetCount} asset files → dist/assets/`);

  const hubDist = join(DIST_DIR, 'hub');
  const hubCount = copyDir(HUB_DIR, hubDist);
  console.log(`Copied ${hubCount} hub files → dist/hub/`);

  // Copy hub/index.html → dist/index.html as the landing page
  const hubIndexSrc = join(HUB_DIR, 'index.html');
  const hubIndexDst = join(DIST_DIR, 'index.html');
  if (existsSync(hubIndexSrc)) {
    copyFileSync(hubIndexSrc, hubIndexDst);
    console.log('Copied index.html → dist/ (landing page)');
  }

  const libCount = copyDir(SRC_LIB_DIR, join(DIST_DIR, 'src', 'lib'), file => file.endsWith('.js'));
  const i18nCount = copyDir(SRC_I18N_DIR, join(DIST_DIR, 'src', 'i18n'), file => file.endsWith('.json'));
  const schemaCount = copyDir(SRC_SCHEMAS_DIR, join(DIST_DIR, 'src', 'schemas'), file => file.endsWith('.json'));
  const contentCount = copyDir(CONTENT_DIR, join(DIST_DIR, 'content'), file => file.endsWith('.json'));
  console.log(`Copied ${libCount} lib files → dist/src/lib/`);
  console.log(`Copied ${i18nCount} i18n files → dist/src/i18n/`);
  console.log(`Copied ${schemaCount} schema files → dist/src/schemas/`);
  console.log(`Copied ${contentCount} content files → dist/content/`);

  await buildPlayerMain();

  // Copy analytics.js + its deps to dist root as fallback for dynamic import in engine-shared.js
  const _fallbackLibs = ['analytics.js', 'storage.js', 'sync-utils.js'];
  for (const f of _fallbackLibs) {
    const src = join(SRC_LIB_DIR, f);
    const dst = join(DIST_DIR, f);
    if (existsSync(src)) { copyFileSync(src, dst); }
  }
  console.log('Copied fallback libs → dist/ (analytics.js, storage.js, sync-utils.js)');

  const rootFiles = ['manifest.webmanifest', 'sw.js', 'player.html', 'update-manifest.json'];
  for (const f of rootFiles) {
    const src = join(ROOT, f);
    const dst = join(DIST_DIR, f);
    if (existsSync(src)) {
      copyFileSync(src, dst);
      console.log(`Copied ${f} → dist/`);
    }
  }

  // ── Phase 8: generate bundleHash for update-manifest.json ──────────────
  const umSrc = join(ROOT, 'update-manifest.json');
  const umDst = join(DIST_DIR, 'update-manifest.json');
  if (existsSync(umSrc)) {
    const manifest = JSON.parse(readFileSync(umSrc, 'utf-8'));
    const engineFiles = manifest.engines || [];
    const assetFiles = manifest.assets || [];
    const bundleItems = [
      ...engineFiles.map(f => join(DIST_DIR, f)),
      ...assetFiles.map(f => join(DIST_DIR, 'assets', f)),
      join(DIST_DIR, 'sw.js'),
      join(DIST_DIR, 'manifest.webmanifest'),
      join(DIST_DIR, 'update-manifest.json'),
    ];
    const hash = createHash('sha256');
    for (const item of bundleItems) {
      if (existsSync(item)) {
        hash.update(readFileSync(item));
      }
    }
    manifest.bundleHash = hash.digest('hex');
    manifest.generatedAt = new Date().toISOString();
    manifest.build = new Date().toISOString();
    writeFileSync(umDst, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`Generated update-manifest.json with bundleHash: ${manifest.bundleHash.substring(0, 16)}...`);

    // Inject CURRENT_VERSION into dist/sw.js (the root sw.js keeps __SW_VERSION__ placeholder)
    const swDst2 = join(DIST_DIR, 'sw.js');
    if (existsSync(swDst2)) {
      let swContent = readFileSync(swDst2, 'utf-8');
      swContent = swContent.replace('__SW_VERSION__', manifest.version);
      writeFileSync(swDst2, swContent, 'utf-8');
      console.log(`Injected CURRENT_VERSION=${manifest.version} into dist/sw.js`);
    }
  }

  console.log('Build complete.');
}

runBuild().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
