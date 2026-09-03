export type SessionMode = "tutor" | "timed";
export type SessionStrategy = "single" | "split";
export type SessionOrder = "sequential" | "random";

export interface SessionStartOptions {
  mode: SessionMode;
  strategy: SessionStrategy;
  questionCount: number;
  order: SessionOrder;
  timerMinutes?: number;
  onlyMode?: import("./qbank-pool").OnlyMode;
  chapters?: string[];
  questionType?: "all" | "mcq" | "written";
  difficulty?: "all" | "easy" | "medium" | "hard";
}
