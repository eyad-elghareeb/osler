import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import quizSchema from '../schemas/quiz-v1.json' with { type: 'json' };
import bankSchema from '../schemas/bank-v1.json' with { type: 'json' };
import flashcardSchema from '../schemas/flashcard-v1.json' with { type: 'json' };
import writtenSchema from '../schemas/written-v1.json' with { type: 'json' };
import osceSchema from '../schemas/osce-v1.json' with { type: 'json' };
import hubSchema from '../schemas/hub-v1.json' with { type: 'json' };
import metaRegistry from '../schemas/_meta.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
addFormats(ajv);
// Phase 6.5 fix (medium): removed the permissive date-time override that
// accepted date-only strings ("2026-06-23") as valid date-time. The standard
// ajv-formats date-time validator enforces RFC 3339 (e.g. "2026-06-23T00:00:00Z"),
// matching the schema intent. All existing fixtures use full ISO 8601 datetimes.

// Schema registry keyed by `${type}:${version}` so we can dispatch on
// meta.schemaVersion. Today only v1 schemas exist; when v2 lands, add a
// `quiz:2.0` entry and a migration in src/lib/migrations/.
const SCHEMAS = {
  quiz: quizSchema,
  bank: bankSchema,
  flashcard: flashcardSchema,
  written: writtenSchema,
  osce: osceSchema,
  hub: hubSchema,
};

const validators = {};
for (const [type, schema] of Object.entries(SCHEMAS)) {
  validators[type] = ajv.compile(schema);
}

// Build a Set of known schemaVersions per type from _meta.json.
// Used to enforce the V19 versioning policy: validate.js must reject content
// where meta.schemaVersion is missing OR unknown.
const KNOWN_VERSIONS_BY_TYPE = new Map();
for (const [type, entry] of Object.entries(metaRegistry.schemas || {})) {
  // entry.version is the current version (e.g. "1.0"). Future v2 schemas
  // would add another entry like `${type}V2` and we'd register it here.
  KNOWN_VERSIONS_BY_TYPE.set(type, new Set([entry.version]));
}

export function getKnownVersions(type) {
  return KNOWN_VERSIONS_BY_TYPE.get(type) || new Set();
}

export function isKnownVersion(type, version) {
  const known = KNOWN_VERSIONS_BY_TYPE.get(type);
  return !!known && known.has(version);
}

export function validate(content) {
  const type = content?.type;
  if (!type || !validators[type]) {
    return { valid: false, errors: [{ message: `Unknown content type: ${type}` }] };
  }

  // V19 policy: meta.schemaVersion must be present AND known.
  const declaredVersion = content?.meta?.schemaVersion;
  if (!declaredVersion) {
    return {
      valid: false,
      errors: [{ message: `meta.schemaVersion is missing (required by V19 versioning policy)` }],
    };
  }
  if (!isKnownVersion(type, declaredVersion)) {
    const known = [...(KNOWN_VERSIONS_BY_TYPE.get(type) || [])].join(', ');
    return {
      valid: false,
      errors: [{
        message: `Unknown schemaVersion "${declaredVersion}" for type "${type}". Known versions: [${known}]. See src/schemas/_meta.json.`,
      }],
    };
  }

  const schemaValid = validators[type](content);
  const errors = [...(validators[type].errors || []), ...validateContentRules(content)];
  return { valid: schemaValid && errors.length === 0, errors };
}

export function validateOrThrow(content) {
  const r = validate(content);
  if (!r.valid) throw new Error(`Validation failed: ${JSON.stringify(r.errors, null, 2)}`);
  return content;
}

function validateContentRules(content) {
  // Quiz-style content: questions[] at top level.
  if (Array.isArray(content?.questions)) {
    const errors = content.questions.flatMap((question, index) => {
      const optionCount = question?.options?.length ?? 0;
      if (Number.isInteger(question?.correct) && question.correct >= optionCount) {
        return [{
          instancePath: `/questions/${index}/correct`,
          message: `correct index ${question.correct} is outside options length ${optionCount}`,
        }];
      }
      return [];
    });
    if (errors.length) return errors;
  }

  // Bank content: passages[].questions[] nested.
  if (Array.isArray(content?.passages)) {
    return content.passages.flatMap((passage, pIdx) => {
      const questions = passage?.questions || [];
      return questions.flatMap((question, qIdx) => {
        const optionCount = question?.options?.length ?? 0;
        if (Number.isInteger(question?.correct) && question.correct >= optionCount) {
          return [{
            instancePath: `/passages/${pIdx}/questions/${qIdx}/correct`,
            message: `correct index ${question.correct} is outside options length ${optionCount}`,
          }];
        }
        return [];
      });
    });
  }

  return [];
}
