import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import quizSchema from '../schemas/quiz-v1.json' with { type: 'json' };
import bankSchema from '../schemas/bank-v1.json' with { type: 'json' };
import flashcardSchema from '../schemas/flashcard-v1.json' with { type: 'json' };
import writtenSchema from '../schemas/written-v1.json' with { type: 'json' };
import osceSchema from '../schemas/osce-v1.json' with { type: 'json' };
import hubSchema from '../schemas/hub-v1.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
addFormats(ajv);
ajv.addFormat('date-time', {
  type: 'string',
  validate: value => /^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isNaN(Date.parse(value)),
});

const validators = {
  quiz: ajv.compile(quizSchema),
  bank: ajv.compile(bankSchema),
  flashcard: ajv.compile(flashcardSchema),
  written: ajv.compile(writtenSchema),
  osce: ajv.compile(osceSchema),
  hub: ajv.compile(hubSchema),
};

export function validate(content) {
  const type = content?.type;
  if (!type || !validators[type]) {
    return { valid: false, errors: [{ message: `Unknown content type: ${type}` }] };
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
  if (!Array.isArray(content?.questions)) return [];

  return content.questions.flatMap((question, index) => {
    const optionCount = question?.options?.length ?? 0;
    if (!Number.isInteger(question?.correct) || question.correct < optionCount) return [];

    return [{
      instancePath: `/questions/${index}/correct`,
      message: `correct index ${question.correct} is outside options length ${optionCount}`,
    }];
  });
}
