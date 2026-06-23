export const DEFAULT_STATE = {
  easeFactor: 2.5,
  interval: 0,
  repetitions: 0,
  lapses: 0,
  lastRating: null,
  lastReviewedAt: null,
  totalReviews: 0,
  avgTimePerReview: 0,
  updatedAt: null,
};

const RATING_TO_Q = { 0: 0, 1: 3, 2: 4, 3: 5, 4: 6 };

export function nextReview(state, rating, reviewTimeMs = Date.now()) {
  const q = RATING_TO_Q[rating];
  if (q === undefined) throw new Error(`Invalid rating: ${rating}. Must be 0-4.`);
  const s = { ...DEFAULT_STATE, ...state };
  const newState = { ...s };
  newState.totalReviews = (s.totalReviews || 0) + 1;
  newState.lastRating = rating;
  newState.lastReviewedAt = new Date(reviewTimeMs).toISOString();
  newState.updatedAt = new Date(reviewTimeMs).toISOString();

  if (q < 3) {
    newState.repetitions = 0;
    newState.interval = 1;
    newState.lapses = (s.lapses || 0) + 1;
    newState.easeFactor = Math.max(1.3, s.easeFactor - 0.2);
  } else {
    newState.repetitions = (s.repetitions || 0) + 1;
    if (newState.repetitions === 1) newState.interval = 1;
    else if (newState.repetitions === 2) newState.interval = 6;
    else newState.interval = Math.round(s.interval * s.easeFactor);
    newState.easeFactor = Math.max(1.3, s.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  }

  const nextReviewAt = new Date(reviewTimeMs + newState.interval * 86400000).toISOString();
  newState.nextReviewAt = nextReviewAt;
  return newState;
}

export function isDue(state, now = Date.now()) {
  if (!state) return true;
  if (!state.nextReviewAt) return true;
  return new Date(state.nextReviewAt).getTime() <= now;
}

export function updateAvgTime(state, elapsedMs) {
  const total = state.totalReviews || 0;
  const oldAvg = state.avgTimePerReview || 0;
  return (oldAvg * total + elapsedMs) / (total + 1);
}
