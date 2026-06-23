import { put } from './storage.js';
import { getDeviceId } from './sync-utils.js';

// V20 event taxonomy — the canonical allowed values. Engines MUST use these.
// Adding a new value requires a Phase 1 schema bump and a migration.
export const TAXONOMY = {
  contentType: ['quiz', 'bank', 'flashcard', 'written', 'osce'],
  action: ['started', 'answered', 'flagged', 'completed', 'exported'],
  outcome: ['correct', 'wrong', 'skipped', 'rating_1', 'rating_2', 'rating_3', 'rating_4', null],
};

function validateEnum(field, value, allowed) {
  if (value === null || value === undefined) return true; // null is allowed
  if (!allowed.includes(value)) {
    console.warn(
      `[analytics] Invalid ${field}: "${value}". Allowed: [${allowed.join(', ')}]. ` +
      `Event will still be recorded but Phase 5 admin views may filter it out.`
    );
    return false;
  }
  return true;
}

export function track(event) {
  // Validate taxonomy — warn but don't drop, so engines don't crash mid-session.
  if (event.contentType) validateEnum('contentType', event.contentType, TAXONOMY.contentType);
  if (event.action) validateEnum('action', event.action, TAXONOMY.action);
  if (event.outcome !== undefined) validateEnum('outcome', event.outcome, TAXONOMY.outcome);

  const fullEvent = {
    type: 'study_event',
    contentType: event.contentType,
    contentUid: event.contentUid,
    action: event.action,
    itemId: event.itemId || null,
    outcome: event.outcome ?? null,
    durationMs: event.durationMs || 0,
    deviceId: getDeviceId(),
    ts: new Date().toISOString(),
  };

  // IndexedDB is the offline queue. Failures here mean events are lost — warn loudly.
  put('studyEvents', fullEvent).catch(e => {
    console.warn('[analytics] track() failed to persist event to studyEvents store:', e);
  });

  // Forward to Firebase Analytics if available. The bridge is set by firebase.js
  // (window.firebase.analytics) — see H18 fix in src/lib/firebase.js.
  if (typeof window !== 'undefined' && window.firebase?.analytics) {
    try { window.firebase.analytics.logEvent('study_event', fullEvent); }
    catch (e) { console.warn('[analytics] Firebase Analytics logEvent failed:', e); }
  }
}

export const trackStudyStart = (contentType, contentUid) =>
  track({ contentType, contentUid, action: 'started' });
export const trackAnswer = (contentType, contentUid, itemId, outcome, durationMs) =>
  track({ contentType, contentUid, action: 'answered', itemId, outcome, durationMs });
export const trackFlag = (contentType, contentUid, itemId) =>
  track({ contentType, contentUid, action: 'flagged', itemId });
export const trackComplete = (contentType, contentUid) =>
  track({ contentType, contentUid, action: 'completed' });
export const trackExport = (contentType, contentUid) =>
  track({ contentType, contentUid, action: 'exported' });
