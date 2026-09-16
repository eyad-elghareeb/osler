"use client";

// Admin AI harness: chat panel that drives content tools (list/get/create/
// validate/submit/approve/publish + PDF parsing) through the admin's own
// session. Speaks OpenAI-compatible endpoints (OpenAI, Opencode Zen, Gemini's
// OpenAI shim) and native Gemini generateContent via the AI SDK.
//
// Performance isolation: agent.ts is dynamically imported on first send, so
// the `ai` SDK + provider packages load only inside /admin/assistant and
// never touch the student bundle or other admin pages.

import * as React from "react";
import { motion } from "framer-motion";
import { Bot, Send, Square, FlaskConical, FileUp, Check, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { PageHeader, OslerCard, EmptyState } from "@/components/osler/ui-primitives";
import { ThinkingStatus } from "@/components/osler/thinking-status";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { adminApi } from "@/components/osler/admin/admin-api";
import {
  loadProviderConfig,
  saveProviderConfig,
  PROVIDER_DEFAULTS,
  type ChatMsg,
  type ProviderConfig,
  type ProviderKind,
} from "./types";
import type { ModelMessage } from "./agent";

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const MODEL_PRESETS: Record<ProviderKind, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
  "gemini-native": ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.1-pro-preview"],
  zen: [],
};

type PdfMode = "qbank" | "written" | "raw";

const KIND_LABEL: Record<ProviderKind, "admin.assistant.kind.openai" | "admin.assistant.kind.gemini-native" | "admin.assistant.kind.zen"> = {
  openai: "admin.assistant.kind.openai",
  "gemini-native": "admin.assistant.kind.gemini-native",
  zen: "admin.assistant.kind.zen",
};

export function AssistantPanel() {
  const { t } = useI18n();
  const [config, setConfig] = React.useState<ProviderConfig>(() => loadProviderConfig());
  const [modelInput, setModelInput] = React.useState(config.model);
  const [testing, setTesting] = React.useState(false);
  const [testMsg, setTestMsg] = React.useState<string | null>(null);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [msgs, setMsgs] = React.useState<ChatMsg[]>([]);
  const [input, setInput] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [pdfMode, setPdfMode] = React.useState<PdfMode>("qbank");
  const [parsing, setParsing] = React.useState(false);
  const [configOpen, setConfigOpen] = React.useState(true);

  const historyRef = React.useRef<ModelMessage[]>([]);
  const abortRef = React.useRef<AbortController | null>(null);
  const approvalsRef = React.useRef(new Map<string, (ok: boolean) => void>());
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, running]);

  const pushMsg = React.useCallback((m: Omit<ChatMsg, "id" | "timestamp">) => {
    const full: ChatMsg = { ...m, id: uid(), timestamp: Date.now() };
    setMsgs((prev) => [...prev, full]);
    return full.id;
  }, []);

  const patchToolMsg = React.useCallback((id: string, patch: Partial<ChatMsg["tool"]>) => {
    setMsgs((prev) => prev.map((m) => (m.id === id && m.tool ? { ...m, tool: { ...m.tool, ...patch } } : m)));
  }, []);

  const setField = <K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]) => {
    setConfig((c) => {
      const next = { ...c, [key]: value };
      if (key === "kind") {
        const kind = value as ProviderKind;
        next.baseUrl = PROVIDER_DEFAULTS[kind].baseUrl;
        next.model = PROVIDER_DEFAULTS[kind].model;
        setModelInput(next.model);
      }
      return next;
    });
    setTestMsg(null);
  };

  const handleSave = () => {
    haptic("light");
    saveProviderConfig({ ...config, model: modelInput.trim() || config.model });
    setConfig((c) => ({ ...c, model: modelInput.trim() || c.model }));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  const handleTest = async () => {
    haptic("light");
    setTesting(true);
    setTestMsg(null);
    try {
      const agent = await import("./agent");
      const out = await agent.testProvider({ ...config, model: modelInput.trim() || config.model });
      setTestMsg(t("admin.assistant.testOk", { out }));
    } catch (e: unknown) {
      setTestMsg(t("admin.assistant.testFail", { err: e instanceof Error ? e.message : String(e) }));
    } finally {
      setTesting(false);
    }
  };

  const resolveApproval = (id: string, ok: boolean) => {
    haptic(ok ? "success" : "error");
    patchToolMsg(id, { approved: ok });
    approvalsRef.current.get(id)?.(ok);
    approvalsRef.current.delete(id);
  };

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || running) return;
    const cfg = { ...config, model: modelInput.trim() || config.model };
    if (!cfg.apiKey.trim()) {
      pushMsg({ role: "system-note", text: t("admin.assistant.needConfig") });
      setConfigOpen(true);
      return;
    }
    haptic("light");
    saveProviderConfig(cfg);
    pushMsg({ role: "user", text: body });
    setInput("");
    historyRef.current.push({ role: "user", content: body });
    setRunning(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const agent = await import("./agent");
      const keyOf = (toolName: string, args: Record<string, unknown>) => `${toolName}:${JSON.stringify(args)}`;
      const cardByCall = new Map<string, string>();
      const next = await agent.runAssistantTurn(cfg, historyRef.current, {
        onStep: (stepText, toolCalls) => {
          if (stepText.trim()) pushMsg({ role: "assistant", text: stepText });
          for (const c of toolCalls) {
            const id = pushMsg({
              role: "tool",
              text: c.toolName,
              tool: { toolName: c.toolName, args: c.args, needsApproval: false, approved: null, result: null, isError: false },
            });
            cardByCall.set(keyOf(c.toolName, c.args), id);
          }
        },
        requestApproval: (req) => new Promise<boolean>((resolve) => {
          const id = pushMsg({
            role: "tool",
            text: req.toolName,
            tool: { toolName: req.toolName, args: req.args, needsApproval: true, approved: null, result: null, isError: false },
          });
          cardByCall.set(keyOf(req.toolName, req.args), id);
          approvalsRef.current.set(id, resolve);
        }),
        onToolDone: (toolName, args, result, isError) => {
          const id = cardByCall.get(keyOf(toolName, args));
          if (id) patchToolMsg(id, { result, isError, approved: true });
        },
      }, abort.signal);
      historyRef.current.push(...next);
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") {
        pushMsg({ role: "system-note", text: t("admin.assistant.turnFail", { err: e instanceof Error ? e.message : String(e) }) });
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  const stop = () => {
    haptic("warning");
    abortRef.current?.abort();
  };

  const parsePdfFile = async (file: File) => {
    haptic("light");
    setParsing(true);
    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(file);
      });
      const res = pdfMode === "qbank"
        ? await adminApi.parseQbankPdf(dataUri)
        : pdfMode === "written"
          ? await adminApi.parseWrittenPdf(dataUri)
          : await adminApi.parsePdf(dataUri);
      const summary = summarizeParse(file.name, pdfMode, res);
      pushMsg({ role: "system-note", text: summary });
      setInput((prev) => prev || t("admin.assistant.draftFromPdf", { name: file.name }));
      haptic("success");
    } catch (e: unknown) {
      pushMsg({ role: "system-note", text: t("admin.assistant.turnFail", { err: e instanceof Error ? e.message : String(e) }) });
      haptic("error");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const presets = MODEL_PRESETS[config.kind];

  return (
    <div className="osler-page">
      <div className="osler-page__inner--narrow">
        <PageHeader
          inline
          inlineIcon={Bot}
          title={t("admin.assistant.title")}
          subtitle={t("admin.assistant.subtitle")}
        />

        {/* Provider config */}
        <OslerCard padding="default" className="mb-4">
          <button
            type="button"
            onClick={() => setConfigOpen((v) => !v)}
            className="flex w-full items-center gap-2 text-start"
            aria-expanded={configOpen}
          >
            <FlaskConical className="size-4 text-primary shrink-0" />
            <span className="flex-1 text-sm font-semibold">{t("admin.assistant.provider")}</span>
            <Badge variant="outline" className="font-normal">{t(KIND_LABEL[config.kind])}</Badge>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", configOpen && "rotate-180")} />
          </button>
          {configOpen && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={MOTION_TRANSITION.quick}
              className="mt-3 space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("admin.assistant.kind")}</span>
                  <select
                    value={config.kind}
                    onChange={(e) => setField("kind", e.target.value as ProviderKind)}
                    className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
                  >
                    <option value="openai">{t("admin.assistant.kind.openai")}</option>
                    <option value="gemini-native">{t("admin.assistant.kind.gemini-native")}</option>
                    <option value="zen">{t("admin.assistant.kind.zen")}</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("admin.assistant.model")}</span>
                  <input
                    value={modelInput}
                    onChange={(e) => setModelInput(e.target.value)}
                    placeholder={t("admin.assistant.modelHint")}
                    list="admin-assistant-models"
                    className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
                  />
                  <datalist id="admin-assistant-models">
                    {presets.map((m) => <option key={m} value={m} />)}
                  </datalist>
                </label>
              </div>
              {config.kind !== "gemini-native" && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("admin.assistant.baseUrl")}</span>
                  <input
                    value={config.baseUrl}
                    onChange={(e) => setField("baseUrl", e.target.value)}
                    placeholder={PROVIDER_DEFAULTS[config.kind].baseUrl}
                    dir="ltr"
                    className="h-9 w-full rounded-lg border border-border bg-card px-3 font-[var(--font-code)] text-sm outline-none focus:border-primary"
                  />
                  <span className="block text-[11px] text-muted-foreground">{t("admin.assistant.baseUrlHint")}</span>
                </label>
              )}
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("admin.assistant.apiKey")}</span>
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={(e) => setField("apiKey", e.target.value)}
                  placeholder={t("admin.assistant.apiKeyHint")}
                  dir="ltr"
                  autoComplete="off"
                  className="h-9 w-full rounded-lg border border-border bg-card px-3 font-[var(--font-code)] text-sm outline-none focus:border-primary"
                />
                <span className="block text-[11px] text-muted-foreground">{t("admin.assistant.keyStored")}</span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleSave} className="h-8 text-xs">
                  {savedFlash ? <Check className="size-3 me-1" /> : null}
                  {savedFlash ? t("common.saved") : t("common.saveChanges")}
                </Button>
                <Button size="sm" variant="secondary" onClick={handleTest} disabled={testing} className="h-8 text-xs">
                  {testing ? t("admin.assistant.testing") : t("admin.assistant.test")}
                </Button>
                {testMsg && <span className="text-xs text-muted-foreground">{testMsg}</span>}
              </div>
            </motion.div>
          )}
        </OslerCard>

        {/* Transcript */}
        <OslerCard padding="default" className="mb-4">
          <div ref={scrollRef} className="max-h-[50vh] min-h-48 overflow-y-auto osler-scroll-y space-y-3 pe-1">
            {msgs.length === 0 && !running && (
              <EmptyState icon={Bot} title={t("admin.assistant.empty")} description={t("admin.assistant.emptyDesc")} />
            )}
            {msgs.map((m) => <TranscriptRow key={m.id} msg={m} onResolve={resolveApproval} />)}
            {running && (
              <ThinkingStatus
                phases={[
                  { label: t("admin.assistant.working"), state: "working" },
                  { label: t("admin.assistant.searching"), state: "searching" },
                ]}
              />
            )}
          </div>

          {/* PDF attach */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void parsePdfFile(f);
              }}
            />
            <select
              value={pdfMode}
              onChange={(e) => setPdfMode(e.target.value as PdfMode)}
              aria-label={t("admin.assistant.pdfMode")}
              className="h-8 rounded-lg border border-border bg-card px-2 text-xs outline-none focus:border-primary"
            >
              <option value="qbank">{t("admin.assistant.pdfMode.qbank")}</option>
              <option value="written">{t("admin.assistant.pdfMode.written")}</option>
              <option value="raw">{t("admin.assistant.pdfMode.raw")}</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={parsing}
              className="h-8 text-xs"
            >
              <FileUp className="size-3.5 me-1.5" />
              {parsing ? t("admin.assistant.pdfParsing") : t("admin.assistant.pdfParse")}
            </Button>
          </div>

          {/* Composer */}
          <form
            className="mt-2 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={t("admin.assistant.placeholder")}
              rows={2}
              className="min-h-10 flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {running ? (
              <Button type="button" size="icon" variant="destructive" onClick={stop} aria-label={t("admin.assistant.stop")}>
                <Square className="size-4" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim()} aria-label={t("admin.assistant.send")}>
                <Send className="size-4" />
              </Button>
            )}
          </form>
        </OslerCard>
      </div>
    </div>
  );
}

function summarizeParse(name: string, mode: PdfMode, res: unknown): string {
  const r = res as Record<string, unknown>;
  const pages = typeof r.pageCount === "number" ? r.pageCount : "?";
  const warnings = Array.isArray(r.warnings) ? r.warnings as string[] : [];
  const draft = r.draft as Record<string, unknown[]> | undefined;
  const count = draft
    ? mode === "written"
      ? draft.prompts?.length ?? 0
      : (draft.questions as unknown[])?.length ?? 0
    : undefined;
  const lines = [`PDF "${name}": ${pages} pages${count !== undefined ? `, ${count} items detected` : ""}.`];
  if (r.likelyScanned) lines.push(String(r.note ?? "Scanned PDF — no text layer."));
  for (const w of warnings.slice(0, 12)) lines.push(`- ${w}`);
  if (warnings.length > 12) lines.push(`… +${warnings.length - 12} more warnings`);
  return lines.join("\n");
}

function TranscriptRow({ msg, onResolve }: { msg: ChatMsg; onResolve: (id: string, ok: boolean) => void }) {
  const { t } = useI18n();
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">{msg.text}</div>
      </div>
    );
  }
  if (msg.role === "system-note") {
    return (
      <div className="whitespace-pre-wrap rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{msg.text}</div>
    );
  }
  if (msg.role === "tool" && msg.tool) {
    const toolItem = msg.tool;
    const pending = toolItem.needsApproval && toolItem.approved === null;
    return (
      <div className={cn("rounded-xl border px-3 py-2", toolItem.isError ? "border-destructive/40" : pending ? "border-warning/50" : "border-border")}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-[var(--font-code)] text-[11px]">{toolItem.toolName}</Badge>
          {toolItem.needsApproval && <Badge variant="outline" className="border-warning/50 text-warning text-[11px]">{t("admin.assistant.destructive")}</Badge>}
          {toolItem.approved === false && <Badge variant="outline" className="text-[11px]">{t("admin.assistant.rejected")}</Badge>}
        </div>
        <details className="mt-1.5 text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t("admin.assistant.viewArgs")}</summary>
          <pre dir="ltr" className="mt-1 max-h-40 overflow-auto rounded-lg bg-muted/50 p-2 font-[var(--font-code)] text-[11px]">{truncate(JSON.stringify(toolItem.args, null, 2), 4000)}</pre>
        </details>
        {toolItem.result != null && (
          <pre dir="ltr" className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 font-[var(--font-code)] text-[11px]">{truncate(toolItem.result, 6000)}</pre>
        )}
        {pending && (
          <div className="mt-2">
            <p className="mb-1.5 text-xs text-warning">{t("admin.assistant.destructiveWarn")}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onResolve(msg.id, true)} className="h-8 text-xs">
                <Check className="size-3.5 me-1" />{t("admin.assistant.approve")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onResolve(msg.id, false)} className="h-8 text-xs">
                <X className="size-3.5 me-1" />{t("admin.assistant.reject")}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="max-w-[95%] whitespace-pre-wrap rounded-xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm">{msg.text}</div>
  );
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n…[truncated]` : text;
}
