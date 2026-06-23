import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const SCHEMAS_DIR = join(process.cwd(), 'src', 'schemas');

if (!existsSync(SCHEMAS_DIR)) {
  console.log('validate-schemas: src/schemas/ does not exist, skipping');
  process.exit(0);
}

const ajv = new Ajv({ strict: false, validateSchema: false });
addFormats(ajv);

const files = readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.json') && f !== '_meta.json');
let allValid = true;

for (const f of files) {
  const path = join(SCHEMAS_DIR, f);
  try {
    const schema = JSON.parse(readFileSync(path, 'utf8'));
    ajv.compile(schema);
    console.log(`\u2713 ${f}`);
  } catch (err) {
    console.log(`\u2717 ${f}: ${err.message}`);
    allValid = false;
  }
}

if (allValid) {
  console.log(`All ${files.length} schemas valid.`);
  process.exit(0);
} else {
  process.exit(1);
}
