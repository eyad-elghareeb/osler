/* ================================================================
   user-content-ui.js  —  V2 (Phase 10)
   ----------------------------------------------------------------
   Hub-side UI for user custom content authoring + export/import.
   Renders the "Create", "Export", "Import" buttons in the hub
   and the content authoring modal.

   Vanilla JS — no framework (V2 anti-goal §5.1). Uses src/lib/dom.js
   helpers + src/lib/ui.js for primitives.
   ================================================================ */

import { listUserContent, createUserContent, updateUserContent, deleteUserContent } from './user-content.js';
import { exportContentPack, importContentPack, pickAndImportContentPack, parseContentPack } from './content-pack.js';
import { validate } from './validate.js';
import { t } from './i18n.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hub integration: render the user content toolbar
//
// Called by engines/index-engine.js on hub load. Injects three buttons
// into the hub header: Create, Export, Import.
// ─────────────────────────────────────────────────────────────────────────────

export function renderHubToolbar(container) {
  const toolbar = document.createElement('div');
  toolbar.className = 'user-content-toolbar';
  toolbar.innerHTML = `
    <button class="btn btn-primary uc-create" data-action="create">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      <span data-i18n="userContent.create">${t('userContent.create', null, 'Create')}</span>
    </button>
    <button class="btn btn-secondary uc-export" data-action="export">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span data-i18n="userContent.export">${t('userContent.export', null, 'Export')}</span>
    </button>
    <button class="btn btn-secondary uc-import" data-action="import">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
      </svg>
      <span data-i18n="userContent.import">${t('userContent.import', null, 'Import')}</span>
    </button>
  `;

  toolbar.querySelector('[data-action="create"]').addEventListener('click', openCreateModal);
  toolbar.querySelector('[data-action="export"]').addEventListener('click', openExportModal);
  toolbar.querySelector('[data-action="import"]').addEventListener('click', openImportModal);

  container.appendChild(toolbar);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hub integration: badge user content items in the grid
//
// Called by engines/index-engine.js for each item card. Adds a "Mine"
// badge if the item is in the userContent store.
// ─────────────────────────────────────────────────────────────────────────────

export async function renderUserContentBadge(card, itemUid) {
  const userItems = await listUserContent();
  const isUserContent = userItems.some(i => i.uid === itemUid || i.meta?.uid === itemUid);
  if (!isUserContent) return;

  const badge = document.createElement('span');
  badge.className = 'uc-badge';
  badge.textContent = t('userContent.mine', null, 'Mine');
  badge.title = t('userContent.mineTitle', null, 'You authored this content');
  card.querySelector('.card-badges, .card-header, .card-title')?.appendChild(badge);
}

// ─────────────────────────────────────────────────────────────────────────────
// Create modal — pick a content type, then open the editor
// ─────────────────────────────────────────────────────────────────────────────

function openCreateModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal uc-create-modal">
      <div class="modal-header">
        <h2 data-i18n="userContent.createTitle">${t('userContent.createTitle', null, 'Create Content')}</h2>
        <button class="modal-close" data-action="close">&times;</button>
      </div>
      <div class="modal-body">
        <p data-i18n="userContent.createPrompt">
          ${t('userContent.createPrompt', null, 'Pick a content type to author:')}
        </p>
        <div class="uc-type-grid">
          <button class="uc-type-card" data-type="quiz">
            <div class="uc-type-icon">📝</div>
            <div class="uc-type-name" data-i18n="contentTypes.quiz">${t('contentTypes.quiz', null, 'Quiz')}</div>
            <div class="uc-type-desc" data-i18n="contentTypes.quizDesc">${t('contentTypes.quizDesc', null, 'Multiple-choice timed quiz')}</div>
          </button>
          <button class="uc-type-card" data-type="bank">
            <div class="uc-type-icon">📚</div>
            <div class="uc-type-name" data-i18n="contentTypes.bank">${t('contentTypes.bank', null, 'Bank')}</div>
            <div class="uc-type-desc" data-i18n="contentTypes.bankDesc">${t('contentTypes.bankDesc', null, 'Untimed question bank')}</div>
          </button>
          <button class="uc-type-card" data-type="flashcard">
            <div class="uc-type-icon">🎴</div>
            <div class="uc-type-name" data-i18n="contentTypes.flashcard">${t('contentTypes.flashcard', null, 'Flashcard')}</div>
            <div class="uc-type-desc" data-i18n="contentTypes.flashcardDesc">${t('contentTypes.flashcardDesc', null, 'SM-2 spaced repetition')}</div>
          </button>
          <button class="uc-type-card" data-type="written">
            <div class="uc-type-icon">✍️</div>
            <div class="uc-type-name" data-i18n="contentTypes.written">${t('contentTypes.written', null, 'Written')}</div>
            <div class="uc-type-desc" data-i18n="contentTypes.writtenDesc">${t('contentTypes.writtenDesc', null, 'Free-text with self-rating')}</div>
          </button>
          <button class="uc-type-card" data-type="osce">
            <div class="uc-type-icon">🩺</div>
            <div class="uc-type-name" data-i18n="contentTypes.osce">${t('contentTypes.osce', null, 'OSCE')}</div>
            <div class="uc-type-desc" data-i18n="contentTypes.osceDesc">${t('contentTypes.osceDesc', null, 'Clinical simulation')}</div>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('[data-action="close"]').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelectorAll('.uc-type-card').forEach(card => {
    card.addEventListener('click', () => {
      const type = card.dataset.type;
      overlay.remove();
      openEditor(type);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor — minimal JSON editor with live validation
//
// This is the V2 PWA editor. It's a simplified version of the V1 Tauri
// admin content editor (which has a form view + JSON view + preview).
// The PWA editor is JSON-only (simpler, smaller bundle). For form-based
// authoring, users should use the admin dashboard.
// ─────────────────────────────────────────────────────────────────────────────

function openEditor(type, existingUid) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  let initialItem;
  if (existingUid) {
    // Edit mode — load existing
    listUserContent().then(items => {
      const found = items.find(i => i.uid === existingUid || i.meta?.uid === existingUid);
      if (found) {
        editorTextarea.value = JSON.stringify(found, null, 2);
        validateAndShow();
      }
    });
    initialItem = '';
  } else {
    // Create mode — start with a skeleton
    initialItem = JSON.stringify(buildSkeleton(type), null, 2);
  }

  overlay.innerHTML = `
    <div class="modal uc-editor-modal">
      <div class="modal-header">
        <h2>${existingUid ? 'Edit' : 'Create'} ${type}</h2>
        <button class="modal-close" data-action="close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="uc-editor-layout">
          <div class="uc-editor-left">
            <label class="uc-field">
              <span data-i18n="userContent.titleField">${t('userContent.titleField', null, 'Title')}</span>
              <input type="text" class="uc-title-input" placeholder="My ${type}">
            </label>
            <label class="uc-field">
              <span data-i18n="userContent.tagsField">${t('userContent.tagsField', null, 'Tags (comma-separated)')}</span>
              <input type="text" class="uc-tags-input" placeholder="cardiology, exam-prep">
            </label>
            <label class="uc-field">
              <span data-i18n="userContent.langField">${t('userContent.langField', null, 'Language')}</span>
              <select class="uc-lang-input">
                <option value="en">English</option>
                <option value="ar">العربية</option>
                <option value="mixed">Mixed</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <div class="uc-editor-right">
            <label class="uc-field">
              <span>JSON</span>
              <textarea class="uc-json-input" spellcheck="false"></textarea>
            </label>
            <div class="uc-validation"></div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-action="cancel" data-i18n="common.cancel">
          ${t('common.cancel', null, 'Cancel')}
        </button>
        <button class="btn btn-primary" data-action="save" data-i18n="common.save">
          ${t('common.save', null, 'Save')}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const editorTextarea = overlay.querySelector('.uc-json-input');
  editorTextarea.value = initialItem;

  const validationDiv = overlay.querySelector('.uc-validation');
  const titleInput = overlay.querySelector('.uc-title-input');
  const tagsInput = overlay.querySelector('.uc-tags-input');
  const langInput = overlay.querySelector('.uc-lang-input');

  // If editing existing, pre-fill the form fields
  if (existingUid) {
    listUserContent().then(items => {
      const found = items.find(i => i.uid === existingUid || i.meta?.uid === existingUid);
      if (found) {
        titleInput.value = found.meta?.title || '';
        tagsInput.value = (found.meta?.tags || []).join(', ');
        langInput.value = found.meta?.lang || 'en';
      }
    });
  }

  function validateAndShow() {
    let parsed;
    try {
      parsed = JSON.parse(editorTextarea.value);
    } catch (e) {
      validationDiv.innerHTML = `<div class="uc-error">JSON parse error: ${e.message}</div>`;
      return null;
    }

    const result = validate(parsed);
    if (result.valid) {
      validationDiv.innerHTML = `<div class="uc-ok">✓ Valid</div>`;
    } else {
      validationDiv.innerHTML = `<div class="uc-error">✗ ${result.errors[0]?.message || 'invalid'}</div>`;
    }
    return parsed;
  }

  editorTextarea.addEventListener('input', validateAndShow);

  overlay.querySelector('[data-action="close"]').addEventListener('click', () => overlay.remove());
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const parsed = validateAndShow();
    if (!parsed) return;

    const title = titleInput.value.trim() || `My ${type}`;
    const tags = tagsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const lang = langInput.value;

    try {
      if (existingUid) {
        await updateUserContent(existingUid, {
          ...parsed,
          meta: { ...(parsed.meta || {}), title, tags, lang },
        });
      } else {
        await createUserContent(type, parsed, { title, tags, lang });
      }
      overlay.remove();
      // Reload hub to show the new content
      if (typeof window !== 'undefined' && window.location) {
        window.location.reload();
      }
    } catch (e) {
      validationDiv.innerHTML = `<div class="uc-error">Save failed: ${e.message}</div>`;
    }
  });
}

// Skeleton for new content items — minimal valid JSON for each type
function buildSkeleton(type) {
  const base = {
    meta: {
      uid: '', // will be set by createUserContent
      title: '',
      schemaVersion: '1.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lang: 'en',
      tags: [],
    },
  };

  switch (type) {
    case 'quiz':
      return {
        ...base,
        type: 'quiz',
        settings: { shuffleQuestions: false, shuffleOptions: false, showExplanation: 'after_answer' },
        questions: [{
          id: 'q1',
          stem: 'Question text here?',
          options: [
            { id: 'a', text: 'Option A', correct: true },
            { id: 'b', text: 'Option B', correct: false },
          ],
          explanation: '',
        }],
      };
    case 'bank':
      return {
        ...base,
        type: 'bank',
        settings: { showTags: true, allowSearch: true },
        items: [{
          id: 'b1',
          front: 'Question / prompt',
          back: 'Answer / explanation',
          tags: [],
        }],
      };
    case 'flashcard':
      return {
        ...base,
        type: 'flashcard',
        settings: { newCardsPerDay: 20, maxReviewsPerDay: 200 },
        cards: [{
          id: 'c1',
          front: 'Front',
          back: 'Back',
          tags: [],
        }],
      };
    case 'written':
      return {
        ...base,
        type: 'written',
        settings: { minWords: 50, maxWords: 500, showModelAfterSubmit: true },
        prompts: [{
          id: 'p1',
          scenario: 'Setup / context',
          task: 'The prompt',
          modelAnswer: 'Reference answer',
          rubric: [],
        }],
      };
    case 'osce':
      return {
        ...base,
        type: 'osce',
        settings: { timeLimit: 600, passingScore: 70 },
        case: {
          chiefComplaint: 'Chief complaint',
          patientInfo: { name: '', age: 0, sex: 'male' },
          vitals: {},
          appearance: '',
        },
        stages: {
          history: { availableQuestions: [], requiredQuestions: [], scoring: {} },
          examination: { availableManeuvers: [], requiredManeuvers: [], scoring: {} },
          investigations: { availableTests: [], requiredTests: [], scoring: {} },
          diagnosis: { correctDiagnoses: [], scoring: {} },
          management: { correctActions: [], requiredActions: [], scoring: {} },
        },
      };
    default:
      return { ...base, type };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export modal — multi-select items, download as JSON
// ─────────────────────────────────────────────────────────────────────────────

function openExportModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal uc-export-modal">
      <div class="modal-header">
        <h2 data-i18n="userContent.exportTitle">${t('userContent.exportTitle', null, 'Export Content Pack')}</h2>
        <button class="modal-close" data-action="close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="uc-export-list"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-action="cancel">${t('common.cancel', null, 'Cancel')}</button>
        <button class="btn btn-secondary" data-action="select-all">Select all</button>
        <button class="btn btn-primary" data-action="download">Download .json</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const listEl = overlay.querySelector('.uc-export-list');
  listEl.innerHTML = '<div class="uc-loading">Loading...</div>';

  listUserContent().then(items => {
    if (items.length === 0) {
      listEl.innerHTML = `<p class="uc-empty">${t('userContent.noItems', null, 'You have no custom content to export.')}</p>`;
      return;
    }

    listEl.innerHTML = items.map(item => `
      <label class="uc-item-row">
        <input type="checkbox" value="${item.meta?.uid || item.uid}">
        <div class="uc-item-info">
          <div class="uc-item-title">${item.meta?.title || 'Untitled'}</div>
          <div class="uc-item-meta">${item.type} · ${(item.questions || item.cards || item.items || item.prompts || []).length} items</div>
        </div>
      </label>
    `).join('');
  });

  overlay.querySelector('[data-action="close"]').addEventListener('click', () => overlay.remove());
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('[data-action="select-all"]').addEventListener('click', () => {
    overlay.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = !cb.checked);
  });

  overlay.querySelector('[data-action="download"]').addEventListener('click', async () => {
    const selected = [...overlay.querySelectorAll('input[type="checkbox"]:checked')]
      .map(cb => cb.value);
    if (selected.length === 0) {
      alert('Pick at least one item to export.');
      return;
    }
    try {
      const result = await exportContentPack(selected);
      overlay.remove();
      alert(`Exported ${result.itemCount} item(s) as ${result.filename}`);
    } catch (e) {
      alert(`Export failed: ${e.message}`);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Import modal — file picker + preview + import
// ─────────────────────────────────────────────────────────────────────────────

function openImportModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal uc-import-modal">
      <div class="modal-header">
        <h2 data-i18n="userContent.importTitle">${t('userContent.importTitle', null, 'Import Content Pack')}</h2>
        <button class="modal-close" data-action="close">&times;</button>
      </div>
      <div class="modal-body">
        <p data-i18n="userContent.importPrompt">
          ${t('userContent.importPrompt', null, 'Pick a .json content pack file to import.')}
        </p>
        <button class="btn btn-primary" data-action="pick">Pick file...</button>
        <div class="uc-import-preview"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-action="cancel">${t('common.cancel', null, 'Cancel')}</button>
        <button class="btn btn-primary" data-action="import" disabled>Import</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  let pickedFile = null;

  overlay.querySelector('[data-action="pick"]').addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      pickedFile = input.files?.[0];
      if (!pickedFile) return;

      const jsonStr = await pickedFile.text();
      const parsed = parseContentPack(jsonStr);
      const previewEl = overlay.querySelector('.uc-import-preview');

      if (parsed.errors.length > 0 && parsed.items.length === 0) {
        previewEl.innerHTML = `
          <div class="uc-error">
            <strong>Invalid pack:</strong>
            <ul>${parsed.errors.map(e => `<li>${e.message}</li>`).join('')}</ul>
          </div>
        `;
        overlay.querySelector('[data-action="import"]').disabled = true;
        return;
      }

      previewEl.innerHTML = `
        <div class="uc-pack-meta">
          <strong>${parsed.items.length} items</strong> will be imported
          ${parsed.errors.length > 0 ? `(with ${parsed.errors.length} warnings)` : ''}
        </div>
        <ul class="uc-item-list">
          ${parsed.items.map(item => `
            <li>${item.meta?.title || 'Untitled'} (${item.type})</li>
          `).join('')}
        </ul>
      `;
      overlay.querySelector('[data-action="import"]').disabled = parsed.items.length === 0;
    };
    input.click();
  });

  overlay.querySelector('[data-action="close"]').addEventListener('click', () => overlay.remove());
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('[data-action="import"]').addEventListener('click', async () => {
    if (!pickedFile) return;
    try {
      const result = await importContentPack(pickedFile, { onConflict: 'skip' });
      overlay.remove();
      alert(`Imported ${result.imported} item(s). ${result.skipped} skipped (already exist).`);
      if (result.imported > 0) window.location.reload();
    } catch (e) {
      alert(`Import failed: ${e.message}`);
    }
  });
}
