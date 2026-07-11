"use client";

import * as React from "react";
import {
  quizSettings,
  DEFAULT_QUIZ_SETTINGS,
  type QuizSettings,
} from "@/lib/osler/storage";

/**
 * Reactive wrapper around the persisted quiz settings singleton.
 * Returns a snapshot of the settings and a setter that also persists.
 */
export function useQuizSettings(): {
  settings: QuizSettings;
  update: (patch: Partial<QuizSettings>) => Promise<void>;
  reset: () => Promise<void>;
} {
  const [settings, setSettings] = React.useState<QuizSettings>(
    () => quizSettings.getSync() ?? DEFAULT_QUIZ_SETTINGS
  );

  React.useEffect(() => {
    let mounted = true;
    // Re-pull async in case the cache wasn't hydrated on first render
    quizSettings.get().then((s) => {
      if (mounted) setSettings(s);
    });
    const unsub = quizSettings.subscribe(() => {
      if (mounted) setSettings(quizSettings.getSync());
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const update = React.useCallback(async (patch: Partial<QuizSettings>) => {
    const next = await quizSettings.save(patch);
    setSettings(next);
  }, []);

  const reset = React.useCallback(async () => {
    const next = await quizSettings.reset();
    setSettings(next);
  }, []);

  return { settings, update, reset };
}
