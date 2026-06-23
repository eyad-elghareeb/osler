import { validateOrThrow } from './validate.js';

const cache = new Map();

export async function loadContent(path) {
  if (cache.has(path)) return cache.get(path);

  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);

  const content = await response.json();
  validateOrThrow(content);
  cache.set(path, content);
  return content;
}

export async function loadContentByUid(uid, basePath = './content') {
  const manifest = await loadContent(`${basePath}/manifest.json`);
  const entry = manifest.items.find(item => item.uid === uid);

  if (!entry) throw new Error(`Content not found: ${uid}`);

  return loadContent(`${basePath}/${entry.path}`);
}

export function clearCache() {
  cache.clear();
}
