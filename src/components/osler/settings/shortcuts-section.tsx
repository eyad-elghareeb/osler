"use client";

import * as React from "react";
import { Check, Keyboard, Save, Undo2, RotateCcw, CornerDownLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SHORTCUT_ACTIONS, loadBindings, saveBindings, defaultBindings, findConflicts, describeBinding, type ShortcutScope } from "@/lib/osler/shortcuts";
import { useI18n } from "@/components/osler/i18n-provider";
export function ShortcutsSettingsSection() {
  const { t, tList } = useI18n();
  const [saved, setSaved] = React.useState<Record<string, string>>(() => loadBindings());
  const [draft, setDraft] = React.useState<Record<string, string>>(() => saved);
  const [justSaved, setJustSaved] = React.useState(false);

  const isDirty = React.useMemo(() => {
    for (const a of SHORTCUT_ACTIONS) {
      if ((draft[a.id] ?? "") !== (saved[a.id] ?? "")) return true;
    }
    return false;
  }, [draft, saved]);

  const setBinding = (actionId: string, binding: string) => {
    setDraft((d) => ({ ...d, [actionId]: binding }));
  };

  const handleSave = () => {
    saveBindings(draft);
    setSaved(draft);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const handleDiscard = () => {
    setDraft(saved);
  };

  const handleResetAll = () => {
    setDraft(defaultBindings());
  };

  const handleResetOne = (actionId: string) => {
    const def = defaultBindings()[actionId] ?? "";
    setDraft((d) => ({ ...d, [actionId]: def }));
  };

  const scopeMeta: Record<ShortcutScope, { label: string; description: string }> = {
    global: { label: t("settings.shortcuts.scope.global"), description: t("settings.shortcuts.scope.globalDesc") },
    qbank: { label: t("settings.shortcuts.scope.qbank"), description: t("settings.shortcuts.scope.qbankDesc") },
    flashcard: { label: t("settings.shortcuts.scope.flashcard"), description: t("settings.shortcuts.scope.flashcardDesc") },
    reader: { label: t("settings.shortcuts.scope.reader"), description: t("settings.shortcuts.scope.readerDesc") },
    videos: { label: t("settings.shortcuts.scope.videos"), description: t("settings.shortcuts.scope.videosDesc") },
  };

  const scopes: ShortcutScope[] = ["global", "qbank", "flashcard", "reader", "videos"];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Keyboard className="size-4 text-primary" />
            {t("settings.shortcuts.title")}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          {t("settings.shortcuts.subtitle")}
        </p>

        <div className="space-y-6">
          {scopes.map((scope) => {
            const actions = SHORTCUT_ACTIONS.filter((a) => a.scope === scope);
            const meta = scopeMeta[scope];
            if (!actions.length) return null;
            return (
              <div key={scope}>
                <div className="mb-2">
                  <h3 className="text-sm font-semibold">{meta.label}</h3>
                  <p className="text-[11px] text-muted-foreground">{meta.description}</p>
                </div>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full">
                    <tbody>
                      {actions.map((a, idx) => {
                        const currentBinding = draft[a.id] ?? "";
                        const conflicts = findConflicts(draft, a.id, currentBinding);
                        const isDefault = currentBinding === a.defaultBinding;
                        const conflictNames = conflicts
                          .map((c) => {
                            const act = SHORTCUT_ACTIONS.find((x) => x.id === c);
                            return act ? t(act.labelKey) : c;
                          })
                          .join(", ");
                        return (
                          <tr key={a.id} className={idx > 0 ? "border-t border-border" : ""}>
                            <td className="py-2.5 px-3 align-middle w-1/2">
                              <div className="text-sm font-medium">{t(a.labelKey)}</div>
                              <div className="text-[11px] text-muted-foreground">{t(a.descriptionKey)}</div>
                              {conflicts.length > 0 && (
                                <div className="text-[11px] text-warning mt-1">
                                  ⚠ {t("settings.shortcuts.conflictsWith", { names: conflictNames })}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 align-middle">
                              <KeyCaptureInput
                                value={currentBinding}
                                onChange={(b) => setBinding(a.id, b)}
                                onReset={() => handleResetOne(a.id)}
                              />
                              {!isDefault && currentBinding && (
                                <div className="text-[11px] text-muted-foreground mt-1">
                                  {t("settings.shortcuts.default")}: <span className="font-mono">{describeBinding(a.defaultBinding)}</span>
                                </div>
                              )}
                              {!currentBinding && (
                                <div className="text-[11px] text-muted-foreground mt-1">{t("settings.shortcuts.disabled")}</div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-4 mt-5 border-t border-border">
          <Button size="sm" variant="default" onClick={handleSave} disabled={!isDirty} className="h-8 text-xs">
            {justSaved ? (
              <><Check className="size-3 me-1" /> {t("common.saved")}</>
            ) : (
              <><Save className="size-3 me-1" /> {t("common.saveChanges")}</>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDiscard} disabled={!isDirty} className="h-8 text-xs">
            <Undo2 className="size-3 me-1" /> {t("common.discard")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleResetAll} className="h-8 text-xs ms-auto">
            <RotateCcw className="size-3 me-1" /> {t("settings.shortcuts.resetAll")}
          </Button>
        </div>
      </Card>

      <Card className="p-4 bg-muted/30">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <CornerDownLeft className="size-3.5 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-foreground mb-1">{t("settings.shortcuts.tipsTitle")}</p>
            <ul className="space-y-1 list-disc list-inside">
              {tList("settings.shortcuts.tips").map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
            <p className="mt-2 text-foreground/80">{t("settings.shortcuts.scopeConflictNote")}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ─── Key capture input (inline) ────────────────────────────────────── */

function KeyCaptureInput({
  value,
  onChange,
  onReset,
}: {
  value: string;
  onChange: (binding: string) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [capturing, setCapturing] = React.useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { setCapturing(false); return; }
    if (e.key === "Backspace") { onChange(""); setCapturing(false); return; }

    const parts: string[] = [];
    if (e.metaKey) parts.push("mod");
    else if (e.ctrlKey) parts.push("ctrl");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey && !["Shift", "Control", "Alt", "Meta"].includes(e.key)) parts.push("shift");
    const key = e.key;
    if (!["Shift", "Control", "Alt", "Meta"].includes(key)) {
      parts.push(key.toLowerCase());
      onChange(parts.join("+"));
      setCapturing(false);
    }
  };

  if (capturing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          onKeyDown={handleKeyDown}
          onBlur={() => setCapturing(false)}
          className="w-full h-8 px-2 rounded border-2 border-primary bg-card text-xs font-mono outline-none"
          placeholder={t("settings.shortcuts.pressKeys")}
          value=""
          readOnly
        />
        <button
          onClick={() => setCapturing(false)}
          className="text-[11px] text-muted-foreground hover:text-foreground shrink-0"
        >
          {t("settings.shortcuts.cancel")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setCapturing(true)}
        className="w-full h-8 px-2 rounded border border-border bg-card text-xs font-mono text-left hover:border-primary/60 transition-colors"
      >
        {value ? describeBinding(value) : <span className="text-muted-foreground italic">{t("settings.shortcuts.clickToSet")}</span>}
      </button>
      {value && (
        <button
          onClick={onReset}
          className="size-6 rounded flex items-center justify-center hover:bg-muted shrink-0"
          title={t("settings.shortcuts.resetOne")}
          aria-label={t("settings.shortcuts.resetOne")}
        >
          <RotateCcw className="size-3" />
        </button>
      )}
    </div>
  );
}

/* ─── Downloads section (offline content cache management) ──────────── */