// Stub — real implementation lands in Phase 1 once src/schemas/ exists.
// Validates all JSON in content/ against src/schemas/*.json
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
const contentDir = join(process.cwd(), 'content');
const schemasDir = join(process.cwd(), 'src', 'schemas');
if (!existsSync(schemasDir)) {
  console.log('validate: no schemas yet (Phase 0 stub), skipping');
  process.exit(0);
}
if (!existsSync(contentDir)) {
  console.log('validate: no content/ dir, nothing to validate');
  process.exit(0);
}
console.log('validate: stub — real implementation pending Phase 1');
process.exit(0);
