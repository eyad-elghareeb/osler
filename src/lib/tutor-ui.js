/* ================================================================
   tutor-ui.js  —  V2 (Phase 12)
   ----------------------------------------------------------------
   Chat modal UI for the AI tutor. Slide-out panel with message
   list, input box, and item context card.

   Also exports the "Ask AI" button factory used by every engine.
   ================================================================ */

import { askTutor, isTutorAvailable, getHistory, clearHistory, onStream, reportResponse } from './tutor.js';
import { t } from './i18n.js';

let _modalInstance = null; // singleton — only one tutor modal at a time

// ─────────────────────────────────────────────────────────────────────────────
// "Ask AI" button — used by every engine
//
// Renders a floating button in the bottom-right (LTR) / bottom-left (RTL)
// corner of the engine page. Clicking opens the tutor modal.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mount the "Ask AI" button on an engine page.
 *
 * @param {object} itemContext — the current item (question + options + answer + explanation)
 * @param {string} itemUid — UID of the current item
 * @returns {Promise<HTMLElement|null>} the button element, or null if tutor unavailable
 */
export async function mountAskAiButton(itemContext, itemUid) {
  const available = await isTutorAvailable();
  if (!available) return null;

  // Remove any existing button (single instance per page)
  const existing = document.querySelector('.tutor-ask-button');
  if (existing) existing.remove();

  const button = document.createElement('button');
  button.className = 'tutor-ask-button';
  button.type = 'button';
  button.setAttribute('aria-label', t('aiTutor.button', null, 'Ask AI'));
  button.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
    </svg>
    <span class="tutor-ask-label">${t('aiTutor.button', null, 'Ask AI')}</span>
  `;

  button.addEventListener('click', () => {
    openTutorModal(itemContext, itemUid);
  });

  document.body.appendChild(button);
  return button;
}

/**
 * Unmount the "Ask AI" button (called when navigating away from an engine page).
 */
export function unmountAskAiButton() {
  document.querySelector('.tutor-ask-button')?.remove();
  if (_modalInstance) {
    _modalInstance.remove();
    _modalInstance = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tutor modal — slide-out panel
// ─────────────────────────────────────────────────────────────────────────────

async function openTutorModal(itemContext, itemUid) {
  // Singleton — close existing modal if open
  if (_modalInstance) {
    _modalInstance.remove();
    _modalInstance = null;
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'tutor-modal-overlay';

  overlay.innerHTML = `
    <div class="tutor-modal" role="dialog" aria-labelledby="tutor-title">
      <div class="tutor-header">
        <h2 id="tutor-title" data-i18n="aiTutor.title">${t('aiTutor.title', null, 'AI Tutor')}</h2>
        <div class="tutor-header-actions">
          <button class="tutor-clear-btn" data-action="clear" title="${t('aiTutor.clearHistory', null, 'Clear history')}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
          <button class="tutor-close-btn" data-action="close" aria-label="Close">&times;</button>
        </div>
      </div>

      <div class="tutor-context-card">
        <details>
          <summary>Current item context</summary>
          <pre class="tutor-context-json"></pre>
        </details>
      </div>

      <div class="tutor-messages" role="log" aria-live="polite"></div>

      <div class="tutor-input-area">
        <textarea
          class="tutor-input"
          placeholder="${t('aiTutor.placeholder', null, 'Ask a question about this item...')}"
          rows="2"
        ></textarea>
        <button class="tutor-send-btn" data-action="send" disabled>
          ${t('aiTutor.send', null, 'Send')}
        </button>
      </div>

      <div class="tutor-disclaimer" data-i18n="aiTutor.disclaimer">
        ${t('aiTutor.disclaimer', null, 'AI responses may be inaccurate. Verify important medical information.')}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  _modalInstance = overlay;

  // Render the item context
  overlay.querySelector('.tutor-context-json').textContent = JSON.stringify(itemContext, null, 2);

  const messagesEl = overlay.querySelector('.tutor-messages');
  const inputEl = overlay.querySelector('.tutor-input');
  const sendBtn = overlay.querySelector('[data-action="send"]');

  // Render existing history
  const history = await getHistory(itemUid);
  for (const msg of history) {
    appendMessage(messagesEl, msg.role, msg.content);
  }

  // Enable send button when there's text
  inputEl.addEventListener('input', () => {
    sendBtn.disabled = !inputEl.value.trim();
  });

  // Send on Enter (Shift+Enter for newline)
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendBtn.click();
    }
  });

  // Send button handler
  sendBtn.addEventListener('click', async () => {
    const question = inputEl.value.trim();
    if (!question) return;

    // Disable input while waiting
    inputEl.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = t('aiTutor.thinking', null, 'Thinking...');

    // Append the user's question
    appendMessage(messagesEl, 'user', question);

    // Append a placeholder assistant message (will be updated via streaming)
    const assistantEl = appendMessage(messagesEl, 'assistant', '');
    assistantEl.classList.add('tutor-message-streaming');

    // Subscribe to streaming updates
    const unsubscribe = onStream(itemUid, (fullText) => {
      assistantEl.querySelector('.tutor-message-content').textContent = fullText;
    });

    try {
      const result = await askTutor(question, itemContext, itemUid);
      // Final update (in case streaming missed the last chunk)
      assistantEl.querySelector('.tutor-message-content').textContent = result.response;
      assistantEl.classList.remove('tutor-message-streaming');

      // Add report button
      const reportBtn = document.createElement('button');
      reportBtn.className = 'tutor-report-btn';
      reportBtn.textContent = t('aiTutor.reportResponse', null, 'Report');
      reportBtn.addEventListener('click', () => {
        const reason = prompt('Why are you reporting this response? (inaccurate / unhelpful / inappropriate / other)') || 'other';
        reportResponse(itemUid, reason);
        reportBtn.disabled = true;
        reportBtn.textContent = 'Reported';
      });
      assistantEl.appendChild(reportBtn);
    } catch (e) {
      assistantEl.querySelector('.tutor-message-content').textContent =
        e.message || t('aiTutor.error', null, 'Sorry, I couldn\'t get a response.');
      assistantEl.classList.add('tutor-message-error');
      assistantEl.classList.remove('tutor-message-streaming');
    } finally {
      unsubscribe();
      sendBtn.textContent = t('aiTutor.send', null, 'Send');
      sendBtn.disabled = false;
      inputEl.focus();
    }

    // Scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  // Close handlers
  overlay.querySelector('[data-action="close"]').addEventListener('click', closeTutorModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeTutorModal();
  });

  // Clear history handler
  overlay.querySelector('[data-action="clear"]').addEventListener('click', async () => {
    if (!confirm('Clear all conversation history for this item?')) return;
    await clearHistory(itemUid);
    messagesEl.innerHTML = '';
  });

  // Focus the input
  inputEl.focus();

  // Escape to close
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeTutorModal();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}

function closeTutorModal() {
  if (_modalInstance) {
    _modalInstance.remove();
    _modalInstance = null;
  }
}

function appendMessage(container, role, content) {
  const msg = document.createElement('div');
  msg.className = `tutor-message tutor-message-${role}`;
  msg.innerHTML = `
    <div class="tutor-message-avatar">${role === 'user' ? '🧑' : '🤖'}</div>
    <div class="tutor-message-content"></div>
  `;
  msg.querySelector('.tutor-message-content').textContent = content;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}
