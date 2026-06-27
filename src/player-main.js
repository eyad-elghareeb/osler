import { loadContent, loadContentByUid } from './lib/content-loader.js';

const ENGINE_FILES = {
  quiz: 'quiz-engine.js',
  bank: 'bank-engine.js',
  flashcard: 'flashcard-engine.js',
  written: 'written-engine.js',
  osce: 'osce-engine.js',
};

async function main() {
  const root = document.getElementById('osler-root');

  try {
    const params = new URLSearchParams(window.location.search);
    const content = await resolveContent(params);

    root.replaceChildren(document.createElement('div'));
    setGlobals(content);

    await loadScript('engine-shared.js');
    if (content.type === 'quiz' || content.type === 'bank') {
      await loadScript('engine-tracker.js');
    }
    await loadScript(ENGINE_FILES[content.type]);
  } catch (error) {
    renderError(error, root);
  }
}

main();

async function resolveContent(params) {
  if (params.has('uid')) return loadContentByUid(params.get('uid'));
  if (params.has('path')) return loadContent(params.get('path'));
  return loadContentByUid('sample-quiz-001');
}

function setGlobals(content) {
  const config = toConfig(content);

  window.__QUIZ_ENGINE_BASE = './';
  window.__BANK_ENGINE_BASE = './';
  window.__FLASHCARD_ENGINE_BASE = './';
  window.__WRITTEN_ENGINE_BASE = './';
  window.__OSCE_ENGINE_BASE = './';

  if (content.type === 'quiz') {
    window.QUIZ_CONFIG = config;
    window.QUESTIONS = content.questions;
  } else if (content.type === 'bank') {
    window.BANK_CONFIG = config;
    window.QUESTION_BANK = flattenBankQuestions(content);
  } else if (content.type === 'flashcard') {
    window.BANK_CONFIG = config;
    window.FLASHCARD_BANK = content.cards.map(toFlashcard);
  } else if (content.type === 'written') {
    window.WRITTEN_CONFIG = config;
    window.WRITTEN_QUESTIONS = content.prompts;
  } else if (content.type === 'osce') {
    window.OSCE_CONFIG = config;
    window.OSCE_CASES = content.stations.map(toOsceCase);
  } else {
    throw new Error(`Unsupported content type: ${content.type}`);
  }
}

function toConfig(content) {
  return {
    uid: content.meta.uid,
    title: content.meta.title,
    description: content.meta.description || '',
    icon: content.meta.icon || '',
    tags: content.meta.tags || [],
  };
}

function flattenBankQuestions(content) {
  return content.passages.flatMap(passage =>
    passage.questions.map(question => ({
      ...question,
      passageId: question.passageId || passage.id,
      passage: passage.content,
    }))
  );
}

function toFlashcard(card) {
  if (card.cloze) return { ...card, type: 'cloze', text: card.cloze };
  return { ...card, type: 'basic' };
}

function toOsceCase(station, index) {
  return {
    id: station.id,
    title: station.id || `Station ${index + 1}`,
    task: station.scenario,
    questions: station.rubric || [],
    rubric: { redFlags: station.redFlags || [], differential: station.differential || [] },
  };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('No engine registered for this content type'));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function renderError(error, rootEl) {
  rootEl.innerHTML = `
    <main style="max-width:720px;margin:12vh auto;padding:24px;font-family:system-ui,sans-serif;">
      <h1 style="margin:0 0 12px;">Unable to load content</h1>
      <pre style="white-space:pre-wrap;background:#111827;color:#f9fafb;padding:16px;border-radius:8px;">${escapeHtml(error.message)}</pre>
    </main>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


