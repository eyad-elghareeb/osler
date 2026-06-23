import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { validate } from '../src/lib/validate.js';

const contentDir = join(process.cwd(), 'content');

if (!existsSync(contentDir)) {
  console.log('validate: no content to validate');
  process.exit(0);
}

const files = walkJson(contentDir);

if (files.length === 0) {
  console.log('validate: no content to validate');
  process.exit(0);
}

let failed = false;

for (const file of files) {
  const displayPath = relative(process.cwd(), file).replaceAll('\\', '/');

  try {
    const content = JSON.parse(readFileSync(file, 'utf8'));
    const result = validate(content);

    if (result.valid) {
      console.log(`✓ ${displayPath}`);
    } else {
      failed = true;
      console.log(`✗ ${displayPath}: ${formatErrors(result.errors)}`);
    }
  } catch (error) {
    failed = true;
    console.log(`✗ ${displayPath}: ${error.message}`);
  }
}

process.exit(failed ? 1 : 0);

function walkJson(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkJson(path);
    return entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
  });
}

function formatErrors(errors) {
  if (!errors?.length) return 'unknown validation error';

  return errors
    .map(error => {
      const where = error.instancePath || error.schemaPath || '<root>';
      return `${where} ${error.message}`;
    })
    .join('; ');
}
