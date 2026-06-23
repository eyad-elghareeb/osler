import { put } from './storage.js';

const DEVICE_ID_KEY = 'osler_device_id';
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, id); }
  return id;
}

export function track(event) {
  const fullEvent = {
    type: 'study_event',
    contentType: event.contentType,
    contentUid: event.contentUid,
    action: event.action,
    itemId: event.itemId || null,
    outcome: event.outcome || null,
    durationMs: event.durationMs || 0,
    deviceId: getDeviceId(),
    ts: new Date().toISOString(),
  };
  put('studyEvents', fullEvent).catch(e => console.warn('analytics track failed', e));
  if (window.firebase?.analytics) {
    try { window.firebase.analytics.logEvent('study_event', fullEvent); } catch {}
  }
}

export const trackStudyStart = (contentType, contentUid) => track({ contentType, contentUid, action: 'started' });
export const trackAnswer = (contentType, contentUid, itemId, outcome, durationMs) =>
  track({ contentType, contentUid, action: 'answered', itemId, outcome, durationMs });
export const trackFlag = (contentType, contentUid, itemId) =>
  track({ contentType, contentUid, action: 'flagged', itemId });
export const trackComplete = (contentType, contentUid) =>
  track({ contentType, contentUid, action: 'completed' });
export const trackExport = (contentType, contentUid) =>
  track({ contentType, contentUid, action: 'exported' });
