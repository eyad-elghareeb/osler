/**
 * Achievement registry — the single source of truth for which achievements
 * exist, how they unlock, and the i18n keys that label them. Rendering and
 * persistence live elsewhere (profile.tsx renders; storage.ts persists +
 * syncs the `{ id, unlockedAt }` records), so this module stays React-free.
 */

import type { StringKey } from "@/lib/osler/i18n";

/** Stats the profile view can compute from synced local data. */
export interface AchievementStats {
  attempted: number;
  correct: number;
  accuracy: number;
  packsStarted: number;
  sessionsCompleted: number;
  flashcardsReviewed: number;
  notesCount: number;
  /** Current consecutive-day streak (with 24h grace window). */
  currentStreak: number;
}

/** A persisted, syncable achievement unlock record. */
export interface AchievementRecord {
  id: string;
  unlockedAt: number;
}

/** Icon key — mapped to a lucide component by the renderer (lib stays React-free). */
export type AchievementIconKey =
  | "target"
  | "award"
  | "zap"
  | "calendar"
  | "trending"
  | "flame"
  | "star"
  | "shield"
  | "medal"
  | "session"
  | "flashcard"
  | "notes";

export interface AchievementDef {
  id: string;
  titleKey: StringKey;
  descKey: StringKey;
  icon: AchievementIconKey;
  /** Returns true when the achievement is earned for the given stats. */
  check: (s: AchievementStats) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "first-steps",
    titleKey: "profile.ach.firstSteps.title",
    descKey: "profile.ach.firstSteps.desc",
    icon: "target",
    check: (s) => s.attempted >= 1,
  },
  {
    id: "sharp-shooter",
    titleKey: "profile.ach.sharpShooter.title",
    descKey: "profile.ach.sharpShooter.desc",
    icon: "award",
    check: (s) => s.correct >= 10,
  },
  {
    id: "on-fire",
    titleKey: "profile.ach.onFire.title",
    descKey: "profile.ach.onFire.desc",
    icon: "zap",
    check: (s) => s.attempted >= 20 && s.accuracy >= 80,
  },
  {
    id: "consistent",
    titleKey: "profile.ach.consistent.title",
    descKey: "profile.ach.consistent.desc",
    icon: "calendar",
    check: (s) => s.packsStarted >= 3,
  },
  {
    id: "determined",
    titleKey: "profile.ach.determined.title",
    descKey: "profile.ach.determined.desc",
    icon: "trending",
    check: (s) => s.attempted >= 50,
  },
  {
    id: "marathon",
    titleKey: "profile.ach.marathon.title",
    descKey: "profile.ach.marathon.desc",
    icon: "flame",
    check: (s) => s.attempted >= 100,
  },
  {
    id: "century-club",
    titleKey: "profile.ach.centuryClub.title",
    descKey: "profile.ach.centuryClub.desc",
    icon: "star",
    check: (s) => s.attempted >= 250,
  },
  {
    id: "unstoppable",
    titleKey: "profile.ach.unstoppable.title",
    descKey: "profile.ach.unstoppable.desc",
    icon: "shield",
    check: (s) => s.attempted >= 500,
  },
  {
    id: "perfectionist",
    titleKey: "profile.ach.perfectionist.title",
    descKey: "profile.ach.perfectionist.desc",
    icon: "medal",
    check: (s) => s.attempted >= 50 && s.accuracy >= 90,
  },
  {
    id: "session-runner",
    titleKey: "profile.ach.sessionRunner.title",
    descKey: "profile.ach.sessionRunner.desc",
    icon: "session",
    check: (s) => s.sessionsCompleted >= 5,
  },
  {
    id: "flashcard-fanatic",
    titleKey: "profile.ach.flashcardFanatic.title",
    descKey: "profile.ach.flashcardFanatic.desc",
    icon: "flashcard",
    check: (s) => s.flashcardsReviewed >= 50,
  },
  {
    id: "note-taker",
    titleKey: "profile.ach.noteTaker.title",
    descKey: "profile.ach.noteTaker.desc",
    icon: "notes",
    check: (s) => s.notesCount >= 5,
  },
  {
    id: "streak-3",
    titleKey: "profile.ach.streak3.title",
    descKey: "profile.ach.streak3.desc",
    icon: "flame",
    check: (s) => s.currentStreak >= 3,
  },
  {
    id: "streak-7",
    titleKey: "profile.ach.streak7.title",
    descKey: "profile.ach.streak7.desc",
    icon: "flame",
    check: (s) => s.currentStreak >= 7,
  },
  {
    id: "streak-30",
    titleKey: "profile.ach.streak30.title",
    descKey: "profile.ach.streak30.desc",
    icon: "flame",
    check: (s) => s.currentStreak >= 30,
  },
];

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Ids of every achievement earned for the given stats (in registry order). */
export function evaluateAchievements(stats: AchievementStats): string[] {
  return ACHIEVEMENTS.filter((a) => a.check(stats)).map((a) => a.id);
}
