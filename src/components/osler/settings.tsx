"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  AlertTriangle,
  Check,
  Keyboard,
  Save,
  Undo2,
  RotateCcw,
  CornerDownLeft,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { storage } from "@/lib/osler/storage";
import {
  SHORTCUT_ACTIONS,
  loadBindings,
  saveBindings,
  resetBindings,
  defaultBindings,
  findConflicts,
  describeBinding,
  type ShortcutScope,
} from "@/lib/osler/shortcuts";

/* ─── Models & storage keys (shared with ai-assistant.tsx) ──────────── */

const MODELS = [
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite (default, fast & modern)"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash (latest, strongest Flash)"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview (most capable, premium)"],
  ["gemma-4-26b-a4b-it", "Gemma 4 26B IT (open model, strong & free)"],
  ["gemma-4-31b-it", "Gemma 4 31B IT (larger open model)"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash (older fallback)"],
] as const;

const STORAGE_KEYS = {
  apiKey: "osler_gemini_api_key",
  model: "osler_gemini_model",
  maxWait: "osler_gemini_max_wait",
} as const;

/* ─── Section tabs ──────────────────────────────────────────────────── */

type SettingsSection = "ai" | "shortcuts" | "danger";

const SECTIONS: { id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "ai", label: "AI Assistant", icon: Sparkles },
  { id: "shortcuts", label: "Keyboard", icon: Keyboard },
  { id: "danger", label: "Data & Reset", icon: AlertTriangle },
];

export function Settings() {
  const [section, setSection] = React.useState<SettingsSection>("ai");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="flex items-center gap-3 mb-6">
          <SettingsIcon className="size-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Settings</h1>
            <p className="text-sm text-muted-foreground">Configure AI assistant, keyboard shortcuts, and manage data</p>
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-border/60 overflow-x-auto osler-scroll">
          {SECTIONS.map((s) => {
            const I = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`relative h-10 px-3 sm:px-4 text-sm font-medium flex items-center gap-2 transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <I className="size-4" />
                {s.label}
                {active && (
                  <motion.div
                    layoutId="settings-section-underline"
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {section === "ai" && <AiSettingsSection />}
        {section === "shortcuts" && <ShortcutsSettingsSection />}
        {section === "danger" && <DangerZoneSection />}
      </motion.div>
    </div>
  );
}

/* ─── AI Assistant section ──────────────────────────────────────────── */

interface AiFormState {
  apiKey: string;
  model: string;
  maxWait: string;
}

function loadAiForm(): AiFormState {
  return {
    apiKey: (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEYS.apiKey)) || "",
    model: (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEYS.model)) || MODELS[0][0],
    maxWait: (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEYS.maxWait)) || "30",
  };
}

function saveAiForm(state: AiFormState): void {
  localStorage.setItem(STORAGE_KEYS.apiKey, state.apiKey);
  localStorage.setItem(STORAGE_KEYS.model, state.model);
  localStorage.setItem(STORAGE_KEYS.maxWait, state.maxWait);
}

function validateAiForm(state: AiFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (state.apiKey && !/^[A-Za-z0-9_\-]{20,}$/.test(state.apiKey.trim())) {
    errors.apiKey = "API keys are usually 30+ characters of letters, digits, hyphens, and underscores.";
  }
  const mw = Number(state.maxWait);
  if (!Number.isFinite(mw) || mw < 5 || mw > 300) {
    errors.maxWait = "Max wait must be between 5 and 300 seconds.";
  }
  return errors;
}

function AiSettingsSection() {
  const [saved, setSaved] = React.useState<AiFormState>(() => loadAiForm());
  const [draft, setDraft] = React.useState<AiFormState>(() => saved);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [justSaved, setJustSaved] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<string | null>(null);

  const isDirty = React.useMemo(
    () => draft.apiKey !== saved.apiKey || draft.model !== saved.model || draft.maxWait !== saved.maxWait,
    [draft, saved],
  );

  const setField = <K extends keyof AiFormState>(key: K, value: AiFormState[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const handleSave = () => {
    const errs = validateAiForm(draft);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    saveAiForm(draft);
    setSaved(draft);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const handleDiscard = () => {
    setDraft(saved);
    setErrors({});
  };

  const handleClearKey = () => {
    const next = { ...draft, apiKey: "" };
    setDraft(next);
    setErrors((prev) => { const n = { ...prev }; delete n.apiKey; return n; });
    saveAiForm(next);
    setSaved(next);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const handleTestKey = async () => {
    if (!draft.apiKey.trim()) {
      setTestResult("No key entered.");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": draft.apiKey },
      });
      const data = await res.json();
      if (data?.models?.length) {
        setTestResult(`✓ Valid key (${data.models.length} models available).`);
      } else {
        setTestResult("✗ Unexpected response. Check the key.");
      }
    } catch {
      setTestResult("✗ Connection failed. Check key or network.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
        <Sparkles className="size-4 text-primary" />
        AI Assistant
      </h2>
      <p className="text-xs text-muted-foreground mb-5">
        Configure the AI study assistant that helps explain questions and concepts during QBank sessions. Changes are saved when you click <kbd className="px-1 py-0.5 rounded border border-border text-[10px]">Save</kbd>.
      </p>

      <div className="space-y-4">
        {/* API Key */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
            <span>Gemini API Key</span>
            {draft.apiKey !== saved.apiKey && (
              <span className="text-[10px] text-amber-500 font-normal">Unsaved changes</span>
            )}
          </label>
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => setField("apiKey", e.target.value)}
            placeholder="Enter your Gemini API key"
            className={`flex-1 w-full h-9 rounded-lg border bg-card px-3 text-sm outline-none transition-colors ${
              errors.apiKey ? "border-destructive focus:border-destructive" : "border-border focus:border-primary"
            }`}
          />
          {errors.apiKey && <p className="text-[11px] text-destructive">{errors.apiKey}</p>}
          {!errors.apiKey && (
            <p className="text-[11px] text-muted-foreground">
              Get a free key at{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" className="text-primary underline">
                AI Studio
              </a>
              . The AI assistant requires a key to work.
            </p>
          )}
        </div>

        {/* Model + Max wait */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Model</label>
            <select
              value={draft.model}
              onChange={(e) => setField("model", e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
            >
              {MODELS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Max Wait Time</label>
            <select
              value={draft.maxWait}
              onChange={(e) => setField("maxWait", e.target.value)}
              className={`w-full h-9 rounded-lg border bg-card px-3 text-sm outline-none transition-colors ${
                errors.maxWait ? "border-destructive" : "border-border focus:border-primary"
              }`}
            >
              <option value="15">15 seconds</option>
              <option value="30">30 seconds</option>
              <option value="60">60 seconds</option>
              <option value="120">2 minutes</option>
            </select>
            {errors.maxWait && <p className="text-[11px] text-destructive">{errors.maxWait}</p>}
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <p className={`text-xs ${testResult.startsWith("✓") ? "text-green-500" : "text-destructive"}`}>
            {testResult}
          </p>
        )}

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
          <Button size="sm" variant="default" onClick={handleSave} disabled={!isDirty} className="h-8 text-xs">
            {justSaved ? (
              <><Check className="size-3 mr-1" /> Saved</>
            ) : (
              <><Save className="size-3 mr-1" /> Save changes</>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDiscard} disabled={!isDirty} className="h-8 text-xs">
            <Undo2 className="size-3 mr-1" /> Discard
          </Button>
          <Button size="sm" variant="secondary" onClick={handleTestKey} disabled={testing} className="h-8 text-xs">
            {testing ? "Testing…" : "Test Connection"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleClearKey} className="h-8 text-xs ml-auto">
            <Trash2 className="size-3 mr-1" /> Clear Key
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ─── Keyboard shortcuts section ────────────────────────────────────── */

function ShortcutsSettingsSection() {
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
    global: { label: "Global", description: "Available everywhere — search, navigation, theme." },
    qbank: { label: "QBank Studio", description: "Available inside a QBank session (next, prev, flag, submit, ...)." },
    reader: { label: "Article Reader", description: "Available when reading an article or in an overlay modal." },
  };

  const scopes: ShortcutScope[] = ["global", "qbank", "reader"];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Keyboard className="size-4 text-primary" />
            Keyboard Shortcuts
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          Click any binding to record a new key combination. Press <kbd className="px-1 py-0.5 rounded border border-border text-[10px]">Esc</kbd> to cancel recording,
          <kbd className="px-1 py-0.5 rounded border border-border text-[10px] ml-1">Backspace</kbd> to disable.
          Changes apply once you click <strong>Save changes</strong>.
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
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  <table className="w-full">
                    <tbody>
                      {actions.map((a, idx) => {
                        const currentBinding = draft[a.id] ?? "";
                        const conflicts = findConflicts(draft, a.id, currentBinding);
                        const isDefault = currentBinding === a.defaultBinding;
                        return (
                          <tr key={a.id} className={idx > 0 ? "border-t border-border/60" : ""}>
                            <td className="py-2.5 px-3 align-middle w-1/2">
                              <div className="text-sm font-medium">{a.label}</div>
                              <div className="text-[11px] text-muted-foreground">{a.description}</div>
                              {conflicts.length > 0 && (
                                <div className="text-[11px] text-amber-500 mt-1">
                                  ⚠ Conflicts with: {conflicts.map((c) => SHORTCUT_ACTIONS.find((x) => x.id === c)?.label ?? c).join(", ")}
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
                                <div className="text-[10px] text-muted-foreground mt-1">
                                  Default: <span className="font-mono">{describeBinding(a.defaultBinding)}</span>
                                </div>
                              )}
                              {!currentBinding && (
                                <div className="text-[10px] text-muted-foreground mt-1">Disabled</div>
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

        <div className="flex flex-wrap items-center gap-2 pt-4 mt-5 border-t border-border/60">
          <Button size="sm" variant="default" onClick={handleSave} disabled={!isDirty} className="h-8 text-xs">
            {justSaved ? (
              <><Check className="size-3 mr-1" /> Saved</>
            ) : (
              <><Save className="size-3 mr-1" /> Save changes</>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDiscard} disabled={!isDirty} className="h-8 text-xs">
            <Undo2 className="size-3 mr-1" /> Discard
          </Button>
          <Button size="sm" variant="ghost" onClick={handleResetAll} className="h-8 text-xs ml-auto">
            <RotateCcw className="size-3 mr-1" /> Reset all to defaults
          </Button>
        </div>
      </Card>

      <Card className="p-4 bg-muted/30">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <CornerDownLeft className="size-3.5 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-foreground mb-1">Tips</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Multi-key sequences (e.g. <span className="font-mono">G then D</span> for Dashboard) are supported — record both chords back-to-back.</li>
              <li>On macOS, <span className="font-mono">⌘</span> is the modifier; on Windows/Linux it's <span className="font-mono">Ctrl</span>.</li>
              <li>Shortcuts are ignored while typing in text fields, except those with the <span className="font-mono">Ctrl/⌘</span> modifier.</li>
              <li>Conflicts are detected automatically — two actions can't share the same binding.</li>
            </ul>
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
          placeholder="Press keys…"
          value=""
          readOnly
        />
        <button
          onClick={() => setCapturing(false)}
          className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
        >
          Cancel
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
        {value ? describeBinding(value) : <span className="text-muted-foreground italic">Click to set</span>}
      </button>
      {value && (
        <button
          onClick={onReset}
          className="size-6 rounded flex items-center justify-center hover:bg-muted shrink-0"
          title="Reset to default"
        >
          <RotateCcw className="size-3" />
        </button>
      )}
    </div>
  );
}

/* ─── Danger Zone section ───────────────────────────────────────────── */

function DangerZoneSection() {
  const [progressCount, setProgressCount] = React.useState(0);
  const [confirmClear, setConfirmClear] = React.useState(false);

  React.useEffect(() => {
    const update = () => setProgressCount(storage.allProgress().length);
    update();
    return storage.subscribe(update);
  }, []);

  const handleClearProgress = () => {
    if (typeof window !== "undefined") {
      storage.clearAll();
      setProgressCount(0);
      setConfirmClear(false);
    }
  };

  return (
    <Card className="p-5 border-destructive/30">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-3 text-destructive">
        <AlertTriangle className="size-4" />
        Data & Reset
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Your study data is stored locally in this browser. Clearing your browser cache may also clear this data.
        <br />
        <strong className="text-destructive">This action cannot be undone.</strong>
      </p>

      <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-sm font-medium">{progressCount} pack{progressCount !== 1 ? "s" : ""} with progress</div>
          <div className="text-xs text-muted-foreground">Includes quiz, bank, flashcard, written, and OSCE answers.</div>
        </div>
      </div>

      {!confirmClear ? (
        <Button variant="destructive" size="sm" onClick={() => setConfirmClear(true)} disabled={progressCount === 0}>
          <Trash2 className="size-3.5 mr-1.5" />
          Clear All Progress
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-destructive font-medium">Are you sure?</span>
          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleClearProgress}>
            Yes, clear everything
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmClear(false)}>
            Cancel
          </Button>
        </div>
      )}
    </Card>
  );
}
