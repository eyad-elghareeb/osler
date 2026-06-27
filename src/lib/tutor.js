/* ================================================================
   tutor.js  —  V2 (Phase 12)
   ----------------------------------------------------------------
   Lightweight AI tutor. A chat modal scoped to the current study
   item. Calls Gemini with the item as context. No RAG, no
   embeddings, no vector DB.

   Conversation history is local-only (IndexedDB, not synced).
   Capped at 100 messages per item.

   Reuses V1 src/lib/gemini.js for the API client + cost caps.
   ================================================================ */

import { getAll, put } from './storage.js';
import { isFirebaseEnabled } from './firebase.js';
import { currentUser } from './auth.js';
import { t } from './i18n.js';

const HISTORY_STORE = 'tutorHistory';
const MAX_MESSAGES_PER_ITEM = 100;

// ─────────────────────────────────────────────────────────────────────────────
// System prompt builder
//
// Fixed instructions + the current item as JSON context. The model is
// told to stay focused on the item, say "I'm not sure" when uncertain,
// and keep responses concise.
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(itemContext) {
  const itemJson = JSON.stringify(itemContext, null, 2);

  return `You are a medical education tutor. The student is looking at this item:

${itemJson}

Answer their question. If the answer isn't clear from the item, use your general medical knowledge but say so. Stay focused on the current item — if the student asks about something unrelated, politely decline.

Keep responses concise (3-5 sentences). Use markdown for structure (bullet lists, bold for key terms).

If you're uncertain, say "I'm not sure" — do not hallucinate medical facts. Patient safety depends on accuracy.

Respond in the language the student uses (English or Arabic).`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if the AI tutor is available.
 * Requires: Firebase enabled + a Gemini API key configured.
 *
 * @returns {Promise<boolean>}
 */
export async function isTutorAvailable() {
  if (!isFirebaseEnabled()) return false;

  // Check if Gemini API key is configured (via window.OslerGemini bridge)
  if (typeof window !== 'undefined' && window.OslerGemini) {
    return !!(await window.OslerGemini.getApiKey?.());
  }

  // Fallback: dynamic import
  try {
    const gemini = await import('./gemini.js');
    return !!(await gemini.getApiKey?.());
  } catch {
    return false;
  }
}

/**
 * Ask the tutor a question about the current item.
 *
 * @param {string} question — user's question
 * @param {object} itemContext — the current item (question + options + answer + explanation)
 * @param {string} itemUid — UID of the current item (for history lookup)
 * @returns {Promise<{ response: string, history: object[] }>}
 * @throws if cost cap reached, network error, or Gemini error
 */
export async function askTutor(question, itemContext, itemUid) {
  if (!question || !question.trim()) {
    throw new Error('[tutor] question is required');
  }
  if (!itemContext) {
    throw new Error('[tutor] itemContext is required');
  }
  if (!itemUid) {
    throw new Error('[tutor] itemUid is required');
  }

  if (!(await isTutorAvailable())) {
    throw new Error(t('errors.firebaseConfigMissing', null, 'AI tutor is not available.'));
  }

  // Load history for this item
  let history = await getHistory(itemUid);

  // Build the messages array
  const systemPrompt = buildSystemPrompt(itemContext);
  const messages = [
    ...history.map(m => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user', content: question },
  ];

  // Call Gemini via the lib bridge
  let gemini;
  if (typeof window !== 'undefined' && window.OslerGemini) {
    gemini = window.OslerGemini;
  } else {
    gemini = await import('./gemini.js');
  }

  // Check cost caps BEFORE the call
  if (gemini.getTodaysSpend) {
    const today = await gemini.getTodaysSpend();
    const dailyCap = gemini.DAILY_CAP || 20;
    if (today >= dailyCap) {
      throw new Error(t('aiTutor.dailyCapReached', null, 'Daily AI limit reached.'));
    }
  }

  // Call Gemini with streaming
  let responseText = '';
  const onToken = (chunk) => {
    responseText += chunk;
    // Notify streaming listeners (the UI modal subscribes)
    if (_streamListeners[itemUid]) {
      _streamListeners[itemUid](responseText);
    }
  };

  try {
    if (gemini.streamChat) {
      await gemini.streamChat({
        model: 'flash-lite',
        system: systemPrompt,
        messages,
      }, onToken);
    } else if (gemini.chat) {
      const result = await gemini.chat({
        model: 'flash-lite',
        system: systemPrompt,
        messages,
      });
      responseText = result.content;
      onToken(responseText);
    } else {
      throw new Error('Gemini client missing both streamChat and chat');
    }
  } catch (e) {
    console.warn('[tutor] Gemini call failed:', e);
    throw new Error(t('aiTutor.error', null, 'Sorry, I couldn\'t get a response.'));
  }

  // Save history
  const userMessage = {
    role: 'user',
    content: question,
    timestamp: new Date().toISOString(),
  };
  const assistantMessage = {
    role: 'assistant',
    content: responseText,
    timestamp: new Date().toISOString(),
  };

  history = [...history, userMessage, assistantMessage];

  // Cap at MAX_MESSAGES_PER_ITEM (drop oldest)
  if (history.length > MAX_MESSAGES_PER_ITEM) {
    history = history.slice(history.length - MAX_MESSAGES_PER_ITEM);
  }

  await saveHistory(itemUid, history);

  return { response: responseText, history };
}

// ─────────────────────────────────────────────────────────────────────────────
// History management (IndexedDB, per-item, never synced)
// ─────────────────────────────────────────────────────────────────────────────

const _streamListeners = {}; // itemUid -> callback

export async function getHistory(itemUid) {
  const record = await getAll(HISTORY_STORE).catch(() => []);
  const found = record.find(r => r.itemUid === itemUid);
  return found?.messages || [];
}

export async function saveHistory(itemUid, messages) {
  await put(HISTORY_STORE, {
    itemUid,
    messages,
    updatedAt: new Date().toISOString(),
  });
}

export async function clearHistory(itemUid) {
  await put(HISTORY_STORE, {
    itemUid,
    messages: [],
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Subscribe to streaming tokens for a given item.
 * Used by the chat modal to update the UI as tokens arrive.
 *
 * @param {string} itemUid
 * @param {function} onToken — callback(fullText: string)
 * @returns {function} unsubscribe
 */
export function onStream(itemUid, onToken) {
  _streamListeners[itemUid] = onToken;
  return () => {
    delete _streamListeners[itemUid];
  };
}

/**
 * Report a tutor response (for monitoring quality).
 * Sends an analytics event without storing the response content.
 *
 * @param {string} itemUid
 * @param {string} reason — 'inaccurate' | 'unhelpful' | 'inappropriate' | 'other'
 */
export async function reportResponse(itemUid, reason) {
  if (typeof window !== 'undefined' && window.OslerAnalytics) {
    window.OslerAnalytics.track('tutor_response_reported', {
      contentUid: itemUid,
      reason,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expose on window for the engine-shared bridge
// ─────────────────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.OslerTutor = {
    askTutor,
    isTutorAvailable,
    getHistory,
    clearHistory,
    onStream,
    reportResponse,
  };
}
