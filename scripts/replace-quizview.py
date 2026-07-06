#!/usr/bin/env python3
"""Replace the QuizView function body with a 1:1 medos-lite copy."""

import re

FILE = "/home/z/my-project/src/components/osler/qbank-studio.tsx"

with open(FILE, "r") as f:
    content = f.read()

# Find the QuizView function — from "}) {" after the props to the closing "}"
# before "WRITTEN ENGINE VIEW"
lines = content.split("\n")

# Find start: the "}) {" line that comes after "function QuizView("
start_idx = None
for i, line in enumerate(lines):
    if line.strip() == "}) {" and i > 1040:
        # Check this is the QuizView function (look backwards for function QuizView)
        for j in range(i, max(i - 100, 0), -1):
            if "function QuizView(" in lines[j]:
                start_idx = i + 1  # line after "}) {"
                break
        if start_idx:
            break

# Find end: the closing "}" before "WRITTEN ENGINE VIEW" comment
end_idx = None
for i, line in enumerate(lines):
    if "WRITTEN ENGINE VIEW" in line and i > start_idx:
        # The closing } is a few lines before this
        for j in range(i - 1, max(i - 10, 0), -1):
            if lines[j].strip() == "}":
                end_idx = j  # inclusive
                break
        break

print(f"Replacing lines {start_idx + 1} to {end_idx + 1} (1-indexed)")
print(f"First line: {lines[start_idx].rstrip()}")
print(f"Last line:  {lines[end_idx].rstrip()}")

NEW_BODY = '''  const q = session.questions[session.current];
  if (!q) return null;

  const isLast = session.current >= session.questions.length - 1;
  const submitted = session.revealed[session.current] || false;
  const selected = session.answers[session.current];
  const isMCQ = q.correct >= 0;
  const isPausedOrLocked = session.examPaused;
  const engineLabel = ENGINE_META[session.engine].label;

  // Highlighter state
  const [highlightMode, setHighlightMode] = React.useState(false);
  const [highlightColor, setHighlightColor] = React.useState(HIGHLIGHT_COLORS[0]);
  const [eraserMode, setEraserMode] = React.useState(false);
  const [colorPickerOpen, setColorPickerOpen] = React.useState(false);
  const [textSettingsOpen, setTextSettingsOpen] = React.useState(false);
  const [textControls, setTextControls] = React.useState<TextControls>({
    fontSize: 15,
    lineHeight: 1.7,
  });
  const [articleSearchOpen, setArticleSearchOpen] = React.useState(false);
  const [mobileTutorTab, setMobileTutorTab] = React.useState<"question" | "answer">("question");

  // Sticky notes
  const [notes, setNotes] = React.useState<StickyNoteData[]>([]);
  const noteColorIdx = React.useRef(0);
  const questionBodyRef = React.useRef<HTMLElement>(null);

  const tc = textControls;
  const stemStyle = React.useMemo(
    () => ({ fontSize: `${tc.fontSize}px`, lineHeight: tc.lineHeight }),
    [tc.fontSize, tc.lineHeight]
  );

  // Load highlights + sticky notes for current question
  React.useEffect(() => {
    setNotes(stickyNotes.get(activeItem.uid, session.current));
    setMobileTutorTab("question");
  }, [activeItem.uid, session.current]);

  // Highlight mode: auto-apply on text selection
  React.useEffect(() => {
    if (!highlightMode) return;
    const handler = () => {
      if (submitted) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString().trim();
      if (!text) return;
      const hl: HighlightItem = {
        id: crypto.randomUUID(),
        color: highlightColor,
        text,
        target: "stem",
      };
      highlights.add(activeItem.uid, session.current, hl);
      window.getSelection()?.removeAllRanges();
    };
    document.addEventListener("mouseup", handler);
    return () => document.removeEventListener("mouseup", handler);
  }, [highlightMode, highlightColor, activeItem.uid, session.current, submitted]);

  // Eraser mode: click to remove most recent highlight
  React.useEffect(() => {
    if (!eraserMode) return;
    const handler = () => {
      const all = highlights.get(activeItem.uid, session.current);
      if (all.length > 0) {
        highlights.remove(activeItem.uid, session.current, all[all.length - 1].id);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [eraserMode, activeItem.uid, session.current]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f" || e.key === "F") { e.preventDefault(); onToggleFlag(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); onPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); onNext(); }
      if (isMCQ && !submitted) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= q.choices.length) {
          e.preventDefault();
          onSelect(num - 1);
        }
      }
      if (e.key === "Enter" && !submitted) {
        if (isMCQ ? selected !== undefined : true) {
          e.preventDefault();
          onSubmit();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [q, isMCQ, submitted, selected, onToggleFlag, onPrev, onNext, onSelect, onSubmit]);

  const addStickyNote = () => {
    const note: StickyNoteData = {
      id: crypto.randomUUID(),
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 100,
      text: "",
      color: STICKY_COLORS[noteColorIdx.current % STICKY_COLORS.length],
    };
    noteColorIdx.current++;
    stickyNotes.add(activeItem.uid, session.current, note);
    setNotes(stickyNotes.get(activeItem.uid, session.current));
  };

  const updateNote = (id: string, text: string) => {
    stickyNotes.update(activeItem.uid, session.current, id, text);
    setNotes(stickyNotes.get(activeItem.uid, session.current));
  };

  const moveNote = (id: string, x: number, y: number) => {
    stickyNotes.move(activeItem.uid, session.current, id, x, y);
    setNotes(stickyNotes.get(activeItem.uid, session.current));
  };

  const deleteNote = (id: string) => {
    stickyNotes.delete(activeItem.uid, session.current, id);
    setNotes(stickyNotes.get(activeItem.uid, session.current));
  };

  const currentHighlights = highlights.get(activeItem.uid, session.current);
  const strikethroughs = session.strikethroughs[session.current] ?? [];
  const elapsedTime = Math.floor((Date.now() - session.startedAt) / 1000);

  // Written draft
  const writtenDraft = session.writtenDrafts[q.id] ?? {
    text: "",
    rubricChecked: q.rubric ? q.rubric.map(() => false) : [],
    submitted: false,
  };
  const rubricState = session.rubricState[q.id] ?? (q.rubric ? q.rubric.map(() => false) : []);
  const rating = session.ratings[q.id];

  const answeredCount = Object.keys(session.answers).filter(
    (k) => session.answers[+k] !== undefined
  ).length;
  const flaggedCount = Object.values(session.flagged).filter(Boolean).length;
  const correctCount = session.questions.filter(
    (qq, i) => session.revealed[i] && session.answers[i] === qq.correct
  ).length;
  const incorrectCount = answeredCount - correctCount;
  const progressPct = session.questions.length
    ? Math.round((answeredCount / session.questions.length) * 100)
    : 0;

  const onTextControlChange = (key: keyof TextControls, value: number) => {
    setTextControls((c) => ({ ...c, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col safe-screen">
      {/* ── Top bar (UWorld navy) ─────────────────────────────────────────── */}
      <header
        className="h-12 flex items-center pl-2 sm:pl-4 pr-0 gap-2 shrink-0 border-b border-primary-foreground/10 safe-pt"
        style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
      >
        <button onClick={onGoHome} className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0 medos-touch-target" title="Back to QBank">
          <div className="size-7 rounded-lg bg-primary-foreground/15 flex items-center justify-center">
            <GraduationCap className="size-4" />
          </div>
          <span className="hidden sm:inline text-sm font-semibold tracking-tight">QBank Studio</span>
        </button>

        <div className="h-5 w-px bg-primary-foreground/20 hidden sm:block" />

        <div className="hidden sm:flex items-center gap-2 text-xs opacity-90">
          <span className="font-medium">{activeItem.title}</span>
          <span className="opacity-50">·</span>
          <span className="capitalize">{session.mode} Mode</span>
        </div>

        <button
          onClick={onToggleNavMobile}
          className="lg:hidden size-8 rounded-lg bg-primary-foreground/15 hover:bg-primary-foreground/25 flex items-center justify-center mr-1 medos-touch-target"
          title="Question navigator"
        >
          <ListChecks className="size-4" />
        </button>

        <div className="flex-1 flex items-center justify-center min-w-0">
          <div className="text-sm font-semibold tracking-wide truncate">
            Question {session.current + 1}
            <span className="opacity-70 font-normal"> of {session.questions.length}</span>
          </div>
        </div>

        {/* Text settings popover */}
        <Popover open={textSettingsOpen} onOpenChange={setTextSettingsOpen}>
          <PopoverTrigger asChild>
            <button
              className="size-7 rounded-lg bg-primary-foreground/15 hover:bg-primary-foreground/25 flex items-center justify-center transition-colors"
              title="Text settings"
            >
              <Type className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-3">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Text settings
                </span>
              </div>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground w-16">Font size</span>
                  <button
                    onClick={() => onTextControlChange("fontSize", Math.max(12, tc.fontSize - 1))}
                    className="size-6 rounded bg-primary-foreground/15 hover:bg-primary-foreground/25 flex items-center justify-center transition-colors"
                  >
                    <Minus className="size-3" />
                  </button>
                  <span className="text-xs font-mono tabular-nums w-5 text-center">{tc.fontSize}</span>
                  <button
                    onClick={() => onTextControlChange("fontSize", Math.min(22, tc.fontSize + 1))}
                    className="size-6 rounded bg-primary-foreground/15 hover:bg-primary-foreground/25 flex items-center justify-center transition-colors"
                  >
                    <PlusIcon className="size-3" />
                  </button>
                  <div className="flex items-center gap-1 ml-1">
                    {[13, 15, 17, 19, 21].map((s) => (
                      <button
                        key={s}
                        onClick={() => onTextControlChange("fontSize", s)}
                        className={`size-5 rounded text-[10px] font-mono transition-colors ${
                          tc.fontSize === s ? "bg-primary text-primary-foreground" : "bg-primary-foreground/10 hover:bg-primary-foreground/20"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground w-16">Line height</span>
                  <button
                    onClick={() => onTextControlChange("lineHeight", Math.max(1.3, +(tc.lineHeight - 0.2).toFixed(1)))}
                    className="size-6 rounded bg-primary-foreground/15 hover:bg-primary-foreground/25 flex items-center justify-center transition-colors"
                  >
                    <Minus className="size-3" />
                  </button>
                  <span className="text-xs font-mono tabular-nums w-5 text-center">{tc.lineHeight}</span>
                  <button
                    onClick={() => onTextControlChange("lineHeight", Math.min(2.5, +(tc.lineHeight + 0.2).toFixed(1)))}
                    className="size-6 rounded bg-primary-foreground/15 hover:bg-primary-foreground/25 flex items-center justify-center transition-colors"
                  >
                    <PlusIcon className="size-3" />
                  </button>
                  <div className="flex items-center gap-1 ml-1">
                    {[1.3, 1.5, 1.7, 2.0, 2.3].map((lh) => (
                      <button
                        key={lh}
                        onClick={() => onTextControlChange("lineHeight", lh)}
                        className={`size-5 rounded text-[10px] font-mono transition-colors ${
                          tc.lineHeight === lh ? "bg-primary text-primary-foreground" : "bg-primary-foreground/10 hover:bg-primary-foreground/20"
                        }`}
                      >
                        {lh}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-1">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-mono tabular-nums ${
            session.mode === "timed"
              ? session.examTimeRemaining < 300 ? "bg-red-500/100 text-white" : "bg-primary-foreground/15"
              : "bg-primary-foreground/15"
          }`}>
            <Clock className="size-3.5" />
            {session.mode === "timed" ? formatTime(session.examTimeRemaining) : formatTime(elapsedTime)}
          </div>
          <button
            onClick={onTogglePause}
            className="size-7 rounded-lg bg-primary-foreground/15 hover:bg-primary-foreground/25 flex items-center justify-center transition-colors"
            title={isPausedOrLocked ? "Resume" : "Pause"}
          >
            {isPausedOrLocked ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </button>
        </div>

        {/* Highlight mode toggle + color picker popover */}
        <Popover open={colorPickerOpen} onOpenChange={(open) => {
          setColorPickerOpen(open);
          if (open) { setHighlightMode(true); setEraserMode(false); }
        }}>
          <PopoverTrigger asChild>
            <button
              className={`size-7 rounded-lg flex items-center justify-center transition-colors ${
                highlightMode ? "bg-amber-400 text-amber-950" : "bg-primary-foreground/15 hover:bg-primary-foreground/25"
              }`}
              title="Highlight text"
            >
              <Highlighter className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Highlighter className="size-3 text-amber-500" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Highlight color
                  </span>
                </div>
                <button
                  onClick={() => { setColorPickerOpen(false); setHighlightMode(false); }}
                  className="size-5 rounded flex items-center justify-center hover:bg-muted transition-colors"
                  title="Disable highlighter"
                >
                  <X className="size-3" />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setHighlightColor(c)}
                    className={`size-6 rounded-full border-2 transition-all ${
                      highlightColor === c ? "border-foreground scale-110" : "border-transparent hover:scale-110"
                    }`}
                    style={{ backgroundColor: c }}
                    title={`Highlight ${c}`}
                  />
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground">
                Select text to highlight. {currentHighlights.length} highlights on this question.
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Eraser mode button */}
        <button
          onClick={() => {
            if (!eraserMode) { setEraserMode(true); setHighlightMode(false); setColorPickerOpen(false); }
            else { setEraserMode(false); }
          }}
          className={`size-7 rounded-lg flex items-center justify-center transition-colors ${
            eraserMode ? "bg-red-400 text-red-950" : "bg-primary-foreground/15 hover:bg-primary-foreground/25"
          }`}
          title="Erase highlights"
        >
          <Eraser className="size-3.5" />
        </button>

        {/* Sticky note button */}
        <button
          onClick={addStickyNote}
          className="size-7 rounded-lg bg-primary-foreground/15 hover:bg-primary-foreground/25 flex items-center justify-center transition-colors"
          title="Add sticky note"
        >
          <StickyNote className="size-3.5" />
        </button>
      </header>

      {/* ── Body: Question panel ─────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        {/* Floating navigator overlay (desktop + mobile) */}
        <AnimatePresence>
          {navOpenMobile && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 flex items-start justify-center pt-16 bg-background/60 backdrop-blur-[2px]"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: -8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: -8 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-card border border-border rounded-2xl shadow-2xl w-[90vw] max-w-xl max-h-[70vh] overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-primary text-primary-foreground">
                  <span className="text-sm font-semibold">Question Navigator</span>
                  <button onClick={onToggleNavMobile} className="size-7 rounded-lg hover:bg-primary-foreground/15 flex items-center justify-center">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="overflow-y-auto medos-scroll p-4">
                  <NavigatorPanel
                    session={session}
                    answeredCount={answeredCount} flaggedCount={flaggedCount}
                    correctCount={correctCount} incorrectCount={incorrectCount}
                    progressPct={progressPct}
                    onJumpTo={(idx) => { onJumpTo(idx); onToggleNavMobile(); }}
                    onEndTest={() => { onFinish(); onToggleNavMobile(); }}
                  />
                </div>
                <div className="px-4 py-2.5 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <span>{answeredCount}/{session.questions.length} answered</span>
                  <span>{flaggedCount} flagged</span>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Simple question navigator (left strip) */}
        <div className="hidden md:flex flex-col w-12 shrink-0 border-r border-border bg-sidebar">
          <div className="flex-1 overflow-y-auto medos-scroll p-1 space-y-0.5">
            {session.questions.map((_, i) => {
              const ans = session.answers[i];
              const isCurrent = i === session.current;
              const isFlagged = session.flagged[i];
              const isRevealed = session.revealed[i];
              const isCorrect = ans !== undefined && session.questions[i]?.correct === ans;
              const isIncorrect = ans !== undefined && !isCorrect;
              let bg = "bg-sidebar text-muted-foreground border-transparent";
              if (isCurrent) bg = "ring-2 ring-primary bg-sidebar-accent text-foreground";
              else if (isFlagged) bg = "bg-amber-500/20 text-amber-400 border-amber-500/30";
              else if (isRevealed && isCorrect) bg = "bg-blue-500/20 text-blue-300";
              else if (isRevealed && isIncorrect) bg = "bg-red-500/20 text-red-300";
              else if (ans !== undefined) bg = "bg-primary/25 text-primary";
              return (
                <button
                  key={i}
                  onClick={() => onJumpTo(i)}
                  className={`w-full aspect-square rounded text-[10px] font-semibold border transition-all ${bg}`}
                  title={`Q${i + 1}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center — Question panel */}
        <main ref={questionBodyRef} className="flex-1 min-w-0 flex flex-col bg-background">
          <AnimatePresence>
            {isPausedOrLocked && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 z-30 bg-background/95 flex items-center justify-center"
              >
                <div className="text-center max-w-md">
                  <div className="size-16 rounded-full bg-amber-500/15 border-2 border-amber-500/30 flex items-center justify-center mx-auto mb-4">
                    <Pause className="size-7 text-amber-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-foreground">Test Paused</h3>
                  <p className="text-sm text-muted-foreground mt-2 mb-6">
                    The timer is stopped. Click Resume to continue your test.
                  </p>
                  <Button onClick={onTogglePause} variant="default" className="rounded-xl">
                    <Play className="size-4 mr-2" /> Resume Test
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mobile tutor-mode tab switcher — shown only on phones after submit */}
          {submitted && session.mode === "tutor" && (
            <div className="md:hidden flex border-b border-border bg-muted/30 safe-pt">
              <button
                onClick={() => setMobileTutorTab("question")}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                  mobileTutorTab === "question" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
                }`}
              >
                Question
              </button>
              <button
                onClick={() => setMobileTutorTab("answer")}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                  mobileTutorTab === "answer" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
                }`}
              >
                Explanation
              </button>
            </div>
          )}

          <div
            className={`flex-1 min-h-0 medos-qbank-split ${submitted && session.mode === "tutor" ? "flex flex-row" : "overflow-y-auto medos-scroll"}`}
          >
            {q ? (
              <>
                {/* Left column: question + choices */}
                <div
                  className={`medos-qbank-qcol ${submitted && session.mode === "tutor" ? "w-[55%] overflow-y-auto medos-scroll border-r border-border" : ""} ${mobileTutorTab === "answer" ? "hidden md:block" : ""}`}
                >
                  <div className={`${submitted && session.mode === "tutor" ? "px-4 sm:px-6 py-4" : "px-4 sm:px-6 lg:px-8 py-6 max-w-5xl"}`}>
                    {/* Question header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-border">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] font-medium rounded-md">{engineLabel}</Badge>
                        <span className="opacity-50">·</span>
                        <span className="capitalize">{q.difficulty ?? "standard"}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Question ID: <span className="tabular-nums">#{q.id}</span>
                      </div>
                    </div>

                    {/* Stem */}
                    <div className="relative">
                      <div
                        className="uworld-prose"
                        style={stemStyle}
                      >
                        <p style={{ whiteSpace: "pre-wrap" }}>{q.stem}</p>
                      </div>
                    </div>

                    {/* Choices (MCQ only) */}
                    {isMCQ ? (
                      <div className="mt-6 space-y-2.5">
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          {submitted ? "Read-only review" : "Select one answer"}
                        </div>
                        {submitted && (
                          <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border">
                            <div className="flex items-center gap-1.5">
                              {selected === q.correct ? (
                                <><Check className="size-3.5 text-blue-500" /><span className="text-blue-500 font-semibold">Correct</span></>
                              ) : (
                                <><X className="size-3.5 text-red-500" /><span className="text-red-500 font-semibold">Incorrect</span></>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Timer className="size-3.5" />
                              <span className="font-mono tabular-nums">{formatTime(elapsedTime)}</span>
                              <span className="opacity-60">Time spent</span>
                            </div>
                          </div>
                        )}
                        {q.choices.map((choice, idx) => {
                          const isSelected = selected === idx;
                          const isCorrect = idx === q.correct;
                          const showResult = submitted;
                          const hasStrikethrough = strikethroughs.includes(idx);
                          let stateClass = "border-border bg-card hover:border-primary/50 hover:bg-primary/5";
                          let letterBg = "border-border bg-background text-muted-foreground";
                          let letterContent: React.ReactNode = LETTERS[idx];

                          if (showResult) {
                            if (isCorrect) {
                              stateClass = "border-blue-600 bg-blue-500/10";
                              letterBg = "bg-blue-500/100 text-white border-blue-600";
                              letterContent = <Check className="size-4" />;
                            } else if (isSelected && !isCorrect) {
                              stateClass = "border-red-500 bg-red-500/10";
                              letterBg = "bg-red-500/100 text-white border-red-500";
                              letterContent = <X className="size-4" />;
                            } else {
                              stateClass = "border-border bg-card opacity-60";
                            }
                          } else if (isSelected) {
                            stateClass = "border-primary bg-primary/5";
                            letterBg = "bg-primary text-primary-foreground border-primary";
                          }

                          return (
                            <button
                              key={idx}
                              disabled={submitted}
                              onClick={() => onSelect(idx)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                onToggleStrikethrough(idx);
                              }}
                              className={`w-full text-left p-3 sm:p-3.5 rounded-xl border-2 transition-all flex items-start gap-3 ${stateClass} ${
                                submitted ? "cursor-default" : "cursor-pointer"
                              } ${hasStrikethrough ? "opacity-60" : ""} medos-touch-target`}
                            >
                              <div className={`size-7 rounded-full border-2 flex items-center justify-center text-sm font-semibold shrink-0 ${letterBg}`}>
                                {letterContent}
                              </div>
                              <div className={`flex-1 min-w-0 uworld-prose text-[14px] leading-relaxed pt-0.5 ${hasStrikethrough ? "line-through text-muted-foreground" : ""}`}>
                                {choice}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    {/* Written engine: textarea + rubric */}
                    {session.engine === "written" && (
                      <WrittenEngineView
                        question={q}
                        draft={writtenDraft}
                        submitted={submitted}
                        onTextChange={(text) =>
                          onWrittenDraftChange(q.id, { ...writtenDraft, text })
                        }
                        onRubricToggle={(idx) => {
                          const cur = writtenDraft.rubricChecked;
                          const next = [...cur];
                          while (next.length < (q.rubric?.length ?? 0)) next.push(false);
                          next[idx] = !next[idx];
                          onWrittenDraftChange(q.id, { ...writtenDraft, rubricChecked: next });
                        }}
                      />
                    )}

                    {/* OSCE engine: red flags + differential + rubric */}
                    {session.engine === "osce" && (
                      <OsceEngineView
                        question={q}
                        rubricState={rubricState}
                        submitted={submitted}
                        onRubricToggle={(idx) => onRubricToggle(q.id, idx)}
                      />
                    )}

                    {/* Flashcard: rating buttons (after reveal) */}
                    {session.engine === "flashcard" && submitted && (
                      <div className="mt-6">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          Rate this card
                        </h4>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            onClick={() => onRate(q.id, "hard")}
                            className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                              rating === "hard"
                                ? "border-red-500 bg-red-500/10 text-red-500"
                                : "border-border hover:border-red-500/40"
                            }`}
                          >
                            <X className="size-4 mx-auto mb-1" />
                            Hard
                          </button>
                          <button
                            onClick={() => onRate(q.id, "unknown")}
                            className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                              rating === "unknown"
                                ? "border-amber-500 bg-amber-500/10 text-amber-500"
                                : "border-border hover:border-amber-500/40"
                            }`}
                          >
                            <Eye className="size-4 mx-auto mb-1" />
                            Review
                          </button>
                          <button
                            onClick={() => onRate(q.id, "easy")}
                            className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                              rating === "easy"
                                ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                                : "border-border hover:border-emerald-500/40"
                            }`}
                          >
                            <Check className="size-4 mx-auto mb-1" />
                            Easy
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right column: explanation (split-screen in tutor mode + after submit) */}
                {submitted && session.mode === "tutor" && (
                  <div
                    className={`medos-qbank-acol w-[45%] overflow-y-auto medos-scroll bg-muted/20 ${mobileTutorTab === "question" ? "hidden md:block" : ""}`}
                  >
                    <div className="px-4 sm:px-6 py-4">
                      <ExplanationCard q={q} selected={selected} nonMcq={!isMCQ} />
                    </div>
                  </div>
                )}

                {/* Non-MCQ explanation panel (written, osce, flashcard) */}
                {submitted && !isMCQ && session.mode !== "tutor" && (
                  <div className="border-t border-border bg-muted/20 px-4 sm:px-6 py-4">
                    <div className="max-w-3xl mx-auto">
                      <ExplanationCard q={q} selected={undefined} nonMcq />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="size-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-muted-foreground mt-3">Loading question…</p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom action bar — desktop */}
          <footer className="hidden sm:flex border-t border-border bg-card px-3 sm:px-6 py-2.5 items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={onPrev} disabled={session.current === 0} className="h-9 rounded-lg">
              <ChevronLeft className="size-4 mr-1" /> Previous
            </Button>

            <div className="flex-1" />

            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={onToggleCalculator} className={`h-9 px-2.5 rounded-lg ${calculatorOpen ? "border-primary bg-primary/10 text-primary" : ""}`} title="Calculator">
                <CalcIcon className="size-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={onToggleLabValues} className={`h-9 px-2.5 rounded-lg ${labValuesOpen ? "border-primary bg-primary/10 text-primary" : ""}`} title="Lab Values">
                <FlaskConical className="size-4" />
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={onToggleAiAssistant}
                className={`h-9 px-2.5 rounded-lg ${aiAssistantOpen ? "border-primary bg-primary/10 text-primary" : ""}`}
                title="AI Assistant"
              >
                <Sparkles className="size-4" />
              </Button>
              <Popover open={articleSearchOpen} onOpenChange={setArticleSearchOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 px-2.5 rounded-lg" title="Open Article">
                    <BookOpen className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-0 max-h-64 overflow-y-auto">
                  <div className="py-1">
                    <div className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary border-b border-border">Open Article</div>
                    {Object.values(ARTICLES).map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          onOpenArticle(a.id);
                          setArticleSearchOpen(false);
                        }}
                        className="w-full text-left text-sm px-4 py-2.5 hover:bg-muted transition-colors flex items-center gap-2 border-b border-border/40 last:border-0"
                      >
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{a.title}</span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="h-5 w-px bg-border mx-1 hidden sm:block" />

            <Button
              variant="outline" size="sm" onClick={onToggleFlag}
              className={`h-9 rounded-lg ${session.flagged[session.current] ? "border-amber-400 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15" : ""}`}
              title={session.flagged[session.current] ? "Unflag this question" : "Flag for review"}
            >
              <Flag className={`size-4 ${session.flagged[session.current] ? "fill-amber-500 text-amber-500" : ""}`} />
              <span className="hidden sm:inline ml-1">{session.flagged[session.current] ? "Flagged" : "Flag"}</span>
            </Button>

            <div className="h-5 w-px bg-border mx-1 hidden sm:block" />

            {!submitted && isMCQ && (
              <Button size="sm" onClick={onSubmit} disabled={selected === undefined} className="h-9 rounded-lg">
                Submit Answer
              </Button>
            )}
            {!submitted && !isMCQ && (
              <Button size="sm" onClick={onSubmit} className="h-9 rounded-lg">
                {session.engine === "flashcard" ? "Reveal Answer" : "Submit & Self-Grade"}
              </Button>
            )}
            {submitted && session.mode === "tutor" && (
              <Button variant="outline" size="sm" onClick={onRetry} className="h-9 rounded-lg" title="Retry this question">
                <RotateCcw className="size-4 mr-1" />
                <span className="hidden sm:inline">Retry</span>
              </Button>
            )}

            <Button
              size="sm" onClick={onNext} className="h-9 rounded-lg"
              variant={isLast ? "destructive" : "default"}
            >
              {isLast ? (
                <>End Test <ChevronRight className="size-4 ml-1" /></>
              ) : submitted && session.mode === "tutor" ? (
                <>Next Question <ChevronRight className="size-4 ml-1" /></>
              ) : (
                <>Next <ChevronRight className="size-4 ml-1" /></>
              )}
            </Button>
          </footer>

          {/* Bottom action bar — mobile (compact) */}
          <footer className="sm:hidden border-t border-border bg-card px-3 py-2 flex items-center gap-2 shrink-0 safe-pb medos-tap-none">
            <Button
              variant="outline" size="icon"
              onClick={onPrev} disabled={session.current === 0}
              className="size-10 rounded-lg shrink-0 medos-touch-target"
              title="Previous"
            >
              <ChevronLeft className="size-4" />
            </Button>

            <Button
              variant="outline" size="icon"
              onClick={onToggleFlag}
              className={`size-10 rounded-lg shrink-0 medos-touch-target ${session.flagged[session.current] ? "border-amber-400 bg-amber-500/10 text-amber-300" : ""}`}
              title={session.flagged[session.current] ? "Unflag" : "Flag"}
            >
              <Flag className={`size-4 ${session.flagged[session.current] ? "fill-amber-500 text-amber-500" : ""}`} />
            </Button>

            {/* Tools dropdown for mobile */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="size-10 rounded-lg shrink-0 medos-touch-target" title="Tools">
                  <CalcIcon className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="center" className="min-w-44">
                <div className="py-1">
                  <button onClick={onToggleCalculator} className="w-full text-left text-sm px-3 py-2 hover:bg-muted flex items-center gap-2">
                    <CalcIcon className="size-4" /> Calculator
                  </button>
                  <button onClick={onToggleLabValues} className="w-full text-left text-sm px-3 py-2 hover:bg-muted flex items-center gap-2">
                    <FlaskConical className="size-4" /> Lab Values
                  </button>
                  <button onClick={onToggleAiAssistant} className="w-full text-left text-sm px-3 py-2 hover:bg-muted flex items-center gap-2">
                    <Sparkles className="size-4" /> AI Assistant
                  </button>
                  <button onClick={() => setArticleSearchOpen(true)} className="w-full text-left text-sm px-3 py-2 hover:bg-muted flex items-center gap-2">
                    <BookOpen className="size-4" /> Articles
                  </button>
                  {submitted && session.mode === "tutor" && (
                    <button onClick={onRetry} className="w-full text-left text-sm px-3 py-2 hover:bg-muted flex items-center gap-2">
                      <RotateCcw className="size-4" /> Retry
                    </button>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {/* Primary action button — fills remaining space */}
            {!submitted && isMCQ ? (
              <Button
                size="sm" onClick={onSubmit} disabled={selected === undefined}
                className="flex-1 h-10 rounded-lg medos-touch-target"
              >
                Submit Answer
              </Button>
            ) : !submitted && !isMCQ ? (
              <Button
                size="sm" onClick={onSubmit}
                className="flex-1 h-10 rounded-lg medos-touch-target"
              >
                {session.engine === "flashcard" ? "Reveal Answer" : "Submit"}
              </Button>
            ) : (
              <Button
                size="sm" onClick={onNext}
                variant={isLast ? "destructive" : "default"}
                className="flex-1 h-10 rounded-lg medos-touch-target"
              >
                {isLast
                  ? "End Test"
                  : submitted && session.mode === "tutor"
                  ? "Next Question"
                  : "Next"}
                <ChevronRight className="size-4 ml-1" />
              </Button>
            )}
          </footer>
        </main>
      </div>

      {/* Floating sticky notes */}
      {notes.map((note) => (
        <StickyNoteCard
          key={note.id}
          note={note}
          onUpdate={(text) => updateNote(note.id, text)}
          onDelete={() => deleteNote(note.id)}
          onMove={(x, y) => moveNote(note.id, x, y)}
        />
      ))}
    </div>
  );
}'''

# Replace lines from start_idx to end_idx (inclusive) with NEW_BODY
new_lines = lines[:start_idx] + NEW_BODY.split("\n") + lines[end_idx + 1:]

with open(FILE, "w") as f:
    f.write("\n".join(new_lines))

print(f"Done. New file has {len(new_lines)} lines.")
