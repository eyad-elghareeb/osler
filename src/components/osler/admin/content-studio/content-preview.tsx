"use client";

/**
 * Rendered content previews for the Content Studio detail panel.
 *
 * Turns raw R2 bodies into something readable without leaving the explorer:
 *  - Markdown bodies (library articles) render via react-markdown with the
 *    same `.preview-md` typography the content editor uses.
 *  - JSON bodies are parsed and rendered per content type (quiz / bank /
 *    flashcard / written / osce / video), with the correct option marked,
 *    rich-text fields re-rendered as markdown, and pack images resolved
 *    against the file's own folder.
 *
 * Every preview truncates to the first few items with a "show all" toggle so
 * even large packs stay snappy in the side panel.
 */

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CheckCircle2,
  ListChecks,
  BookOpenText,
  Brain,
  PenLine,
  Stethoscope,
  Video,
  Clock,
  UserRound,
  Tag,
  ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { resolveImageForPreview } from "@/components/osler/admin/editors/image-upload";
import { PREVIEW_MARKDOWN_STYLES } from "@/components/osler/admin/editors/markdown-preview";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import type { ContentType } from "@/components/osler/admin/admin-api";

const PREVIEW_LIMIT = 5;

// ── Type inference ──────────────────────────────────────────────────────────

/** Infer a content type from a parsed JSON pack's top-level array field. */
export function inferContentType(parsed: unknown): ContentType | null {
  const data = parsed as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.questions)) return "quiz";
  if (Array.isArray(data.passages)) return "bank";
  if (Array.isArray(data.cards)) return "flashcard";
  if (Array.isArray(data.prompts)) return "written";
  if (Array.isArray(data.stations)) return "osce";
  if (Array.isArray(data.videos)) return "video";
  return null;
}

// ── Shared markdown + image renderers ───────────────────────────────────────

/** Render a markdown string (frontmatter stripped) with images resolved
 *  against the file's own folder. */
export function MarkdownBody({ md, r2Key, compact }: { md: string; r2Key?: string; compact?: boolean }) {
  return (
    <div className={cn("preview-md min-w-0", compact && "preview-md--compact")}>
      <style>{PREVIEW_MARKDOWN_STYLES}</style>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img({ src, alt, ...props }) {
            const resolved = resolveImageForPreview(String(src ?? ""), { rawR2Key: r2Key });
            return (
              <img
                src={resolved}
                alt={alt ?? ""}
                {...props}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                }}
              />
            );
          },
        }}
      >
        {stripFrontmatter(md)}
      </ReactMarkdown>
    </div>
  );
}

function stripFrontmatter(md: string): string {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") return md;
  let end = 1;
  while (end < lines.length && lines[end]?.trim() !== "---") end++;
  return lines.slice(end + 1).join("\n").trim();
}

function PreviewImages({
  images,
  r2Key,
}: {
  images: { src?: string; alt?: string; caption?: string } | { src?: string; alt?: string; caption?: string }[];
  r2Key?: string;
}) {
  const arr = Array.isArray(images) ? images : [images];
  const items = arr.filter((img) => img?.src);
  if (items.length === 0) return null;
  return (
    <div className="my-1 flex flex-wrap gap-1">
      {items.map((img, i) => (
        <figure key={i} className="max-w-[45%]">
          <img
            src={resolveImageForPreview(img.src!, { rawR2Key: r2Key })}
            alt={img.alt ?? ""}
            className="max-h-24 rounded border border-border object-contain"
          />
          {img.caption && (
            <figcaption className="mt-0.5 text-[10px] text-muted-foreground">{img.caption}</figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

function PreviewHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{title}</span>
    </div>
  );
}

/** Toggle that expands a truncated preview to show every item. */
function ShowAllToggle({
  total,
  shown,
  expanded,
  onToggle,
}: {
  total: number;
  shown: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  if (total <= shown) return null;
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={onToggle}
      className={cn("w-full justify-center", expanded && "text-muted-foreground")}
    >
      <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
      {expanded
        ? t("admin.studio.preview.showLess")
        : t("admin.studio.preview.showAll", { n: total })}
    </Button>
  );
}

/** Shared "show a slice, expandable to everything" state. */
function useReveal(total: number) {
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded ? total : Math.min(PREVIEW_LIMIT, total);
  return { expanded, shown, toggle: () => setExpanded((v) => !v) };
}

function MetaPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border bg-muted/40 px-1.5 py-px text-[10px] text-muted-foreground">
      {label}
    </span>
  );
}

// ── Per-type previews ───────────────────────────────────────────────────────

function QuizPreview({ data, r2Key }: { data: any; r2Key?: string }) {
  const { t } = useI18n();
  const qs = Array.isArray(data?.questions) ? data.questions : [];
  const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const reveal = useReveal(qs.length);
  return (
    <div className="space-y-1.5">
      <PreviewHeader icon={ListChecks} title={t("admin.studio.preview.questions", { n: qs.length })} />
      {qs.slice(0, reveal.shown).map((q: any, i: number) => (
        <div key={q?.id ?? i} className="rounded-md border border-border bg-card p-1.5">
          <div className="mb-1">
            <span className="me-1 text-[11px] font-semibold text-muted-foreground">{i + 1}.</span>
            <span className="text-xs font-semibold"><MarkdownBody compact md={q?.question ?? ""} r2Key={r2Key} /></span>
          </div>
          <PreviewImages images={q?.images} r2Key={r2Key} />
          <ul className="space-y-px">
            {(q?.options ?? []).map((opt: string, oi: number) => {
              const correct = oi === q?.correct;
              return (
                <li
                  key={oi}
                  className={cn(
                    "flex gap-1 rounded px-1 py-px text-[11px]",
                    correct && "bg-success/10 text-success",
                  )}
                >
                  {correct ? (
                    <CheckCircle2 className="mt-px size-2.5 shrink-0" />
                  ) : (
                    <span className="mt-px w-2.5 shrink-0 text-center text-[10px] text-muted-foreground">
                      {letters[oi] ?? oi + 1}
                    </span>
                  )}
                  <span className="min-w-0"><MarkdownBody compact md={opt} r2Key={r2Key} /></span>
                </li>
              );
            })}
          </ul>
          {q?.explanation && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] font-medium text-primary">
                {t("admin.studio.preview.explanation")}
              </summary>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                <MarkdownBody compact md={q.explanation} r2Key={r2Key} />
              </div>
            </details>
          )}
        </div>
      ))}
      <ShowAllToggle total={qs.length} shown={reveal.shown} expanded={reveal.expanded} onToggle={reveal.toggle} />
    </div>
  );
}

function BankPreview({ data, r2Key }: { data: any; r2Key?: string }) {
  const { t } = useI18n();
  const passages = Array.isArray(data?.passages) ? data.passages : [];
  const reveal = useReveal(passages.length);
  return (
    <div className="space-y-1.5">
      <PreviewHeader icon={BookOpenText} title={t("admin.studio.preview.passages", { n: passages.length })} />
      {passages.slice(0, reveal.shown).map((p: any, i: number) => (
        <BankPassage key={p?.id ?? i} passage={p} index={i} r2Key={r2Key} />
      ))}
      <ShowAllToggle total={passages.length} shown={reveal.shown} expanded={reveal.expanded} onToggle={reveal.toggle} />
    </div>
  );
}

function BankPassage({ passage, index, r2Key }: { passage: any; index: number; r2Key?: string }) {
  const { t } = useI18n();
  const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const pQs = Array.isArray(passage?.questions) ? passage.questions : [];
  const pReveal = useReveal(pQs.length);
  return (
    <div className="rounded-md border border-border bg-card p-1.5">
      <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">
        {t("admin.studio.preview.passage", { n: index + 1 })}
      </p>
      <div className="text-xs"><MarkdownBody compact md={passage?.content ?? ""} r2Key={r2Key} /></div>
      <PreviewImages images={passage?.images} r2Key={r2Key} />
      {pQs.length > 0 && (
        <div className="mt-1.5 space-y-1.5 border-t border-border pt-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("admin.studio.preview.questions", { n: pQs.length })}
          </p>
          {pQs.slice(0, pReveal.shown).map((q: any, qi: number) => (
            <div key={q?.id ?? qi} className="rounded border border-border bg-muted/30 p-1.5">
              <p className="mb-1 text-xs font-semibold">
                <span className="me-1 text-muted-foreground">{qi + 1}.</span>
                <MarkdownBody compact md={q?.question ?? ""} r2Key={r2Key} />
              </p>
              <PreviewImages images={q?.images} r2Key={r2Key} />
              <ul className="space-y-px">
                {(q?.options ?? []).map((opt: string, oi: number) => {
                  const correct = oi === q?.correct;
                  return (
                    <li
                      key={oi}
                      className={cn(
                        "flex gap-1 rounded px-1 py-px text-[11px]",
                        correct && "bg-success/10 text-success",
                      )}
                    >
                      {correct ? (
                        <CheckCircle2 className="mt-px size-2.5 shrink-0" />
                      ) : (
                        <span className="mt-px w-2.5 shrink-0 text-center text-[10px] text-muted-foreground">
                          {letters[oi] ?? oi + 1}
                        </span>
                      )}
                      <span className="min-w-0"><MarkdownBody compact md={opt} r2Key={r2Key} /></span>
                    </li>
                  );
                })}
              </ul>
              {q?.explanation && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] font-medium text-primary">
                    {t("admin.studio.preview.explanation")}
                  </summary>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    <MarkdownBody compact md={q.explanation} r2Key={r2Key} />
                  </div>
                </details>
              )}
            </div>
          ))}
          <ShowAllToggle total={pQs.length} shown={pReveal.shown} expanded={pReveal.expanded} onToggle={pReveal.toggle} />
        </div>
      )}
    </div>
  );
}

function FlashcardPreview({ data }: { data: any }) {
  const { t } = useI18n();
  const cards = Array.isArray(data?.cards) ? data.cards : [];
  const subdecks = Array.isArray(data?.subdecks) ? data.subdecks.length : 0;
  const reveal = useReveal(cards.length);

  // Anki cloze syntax {{c1::term::hint}} → visible "term".
  const unCloze = (text: string) =>
    text.replace(/\{\{[^:]*?::([^:}]+)(?:::[^}]*)?\}\}/g, "$1");

  return (
    <div className="space-y-1.5">
      <PreviewHeader
        icon={Brain}
        title={subdecks > 0
          ? `${t("admin.studio.preview.cards", { n: cards.length })} · ${t("admin.studio.preview.subdecks", { n: subdecks })}`
          : t("admin.studio.preview.cards", { n: cards.length })}
      />
      {cards.slice(0, reveal.shown).map((c: any, i: number) => {
        const isCloze = c?.type === "cloze" || !!c?.text;
        return (
          <div key={c?.id ?? i} className="rounded-md border border-border bg-card p-1.5">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t(isCloze ? "admin.studio.preview.cloze" : "admin.studio.preview.basic")} #{i + 1}
            </span>
            {isCloze ? (
              <p className="text-xs"><MarkdownBody compact md={unCloze(c?.text ?? "")} r2Key={undefined} /></p>
            ) : (
              <>
                <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">{t("admin.studio.preview.front")}</p>
                <p className="text-xs"><MarkdownBody compact md={c?.front ?? ""} r2Key={undefined} /></p>
                <p className="mb-0.5 mt-1.5 text-[11px] font-medium text-muted-foreground">{t("admin.studio.preview.back")}</p>
                <p className="text-xs"><MarkdownBody compact md={c?.back ?? ""} r2Key={undefined} /></p>
              </>
            )}
            {(c?.tags ?? []).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {c.tags.slice(0, 4).map((tag: string, ti: number) => (
                  <MetaPill key={ti} label={tag} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <ShowAllToggle total={cards.length} shown={reveal.shown} expanded={reveal.expanded} onToggle={reveal.toggle} />
    </div>
  );
}

function WrittenPreview({ data }: { data: any }) {
  const { t } = useI18n();
  const prompts = Array.isArray(data?.prompts) ? data.prompts : [];
  const reveal = useReveal(prompts.length);
  return (
    <div className="space-y-1.5">
      <PreviewHeader icon={PenLine} title={t("admin.studio.preview.prompts", { n: prompts.length })} />
      {prompts.slice(0, reveal.shown).map((p: any, i: number) => (
        <div key={p?.id ?? i} className="rounded-md border border-border bg-card p-1.5">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">#{i + 1}</span>
            {p?.wordLimit ? <MetaPill label={t("admin.studio.preview.wordLimit", { n: p.wordLimit })} /> : null}
            {(p?.tags ?? []).slice(0, 3).map((tag: string, ti: number) => (
              <MetaPill key={ti} label={tag} />
            ))}
          </div>
          <p className="text-xs"><MarkdownBody compact md={p?.prompt ?? ""} r2Key={undefined} /></p>
          {Array.isArray(p?.rubric) && p.rubric.length > 0 && (
            <div className="mt-1 border-t border-border pt-1">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("admin.studio.preview.rubric")}
              </p>
              <ul className="list-inside list-disc space-y-px text-[11px] text-muted-foreground">
                {p.rubric.slice(0, 4).map((r: string, ri: number) => (
                  <li key={ri}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
      <ShowAllToggle total={prompts.length} shown={reveal.shown} expanded={reveal.expanded} onToggle={reveal.toggle} />
    </div>
  );
}

function OscePreview({ data, r2Key }: { data: any; r2Key?: string }) {
  const { t } = useI18n();
  const stations = Array.isArray(data?.stations) ? data.stations : [];
  const reveal = useReveal(stations.length);
  return (
    <div className="space-y-1.5">
      <PreviewHeader icon={Stethoscope} title={t("admin.studio.preview.stations", { n: stations.length })} />
      {stations.slice(0, reveal.shown).map((s: any, i: number) => (
        <div key={s?.id ?? i} className="rounded-md border border-border bg-card p-1.5">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <span className="text-xs font-semibold">{s?.title ?? s?.id ?? `#${i + 1}`}</span>
            {s?.type ? <MetaPill label={s.type} /> : null}
            {s?.specialty ? <MetaPill label={s.specialty} /> : null}
            {typeof s?.difficulty === "string" ? <MetaPill label={s.difficulty} /> : null}
          </div>
          <div className="mb-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            {s?.task && (
              <span className="flex items-center gap-1"><Tag className="size-3" />{t("admin.studio.preview.task")}: {s.task}</span>
            )}
            {typeof s?.time === "number" && (
              <span className="flex items-center gap-1"><Clock className="size-3" />{t("admin.studio.preview.time", { n: s.time })}</span>
            )}
            {s?.patient?.name && (
              <span className="flex items-center gap-1"><UserRound className="size-3" />{s.patient.name}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground"><MarkdownBody compact md={s?.task ?? ""} r2Key={r2Key} /></div>
          {(s?.questions ?? []).length > 0 && (
            <ul className="mt-1 list-inside list-decimal space-y-px border-t border-border pt-1 text-[11px]">
              {(s.questions ?? []).slice(0, 4).map((q: any, qi: number) => (
                <li key={qi}>{q?.question}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <ShowAllToggle total={stations.length} shown={reveal.shown} expanded={reveal.expanded} onToggle={reveal.toggle} />
    </div>
  );
}

function VideoPreview({ data }: { data: any }) {
  const { t } = useI18n();
  const videos = Array.isArray(data?.videos) ? data.videos : [];
  const reveal = useReveal(videos.length);
  return (
    <div className="space-y-1.5">
      <PreviewHeader icon={Video} title={t("admin.studio.preview.videos", { n: videos.length })} />
      {videos.slice(0, reveal.shown).map((v: any, i: number) => (
        <div key={v?.id ?? i} className="rounded-md border border-border bg-card p-1.5">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{v?.title ?? v?.id ?? `#${i + 1}`}</span>
            {v?.source?.type ? <MetaPill label={v.source.type} /> : null}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            {v?.specialty && (
              <span className="flex items-center gap-1"><Tag className="size-3" />{v.specialty}</span>
            )}
            {typeof v?.duration === "number" && (
              <span className="flex items-center gap-1"><Clock className="size-3" />{t("admin.studio.preview.time", { n: Math.round(v.duration / 60) })}</span>
            )}
          </div>
          {v?.description && (
            <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2"><MarkdownBody compact md={v.description} r2Key={undefined} /></p>
          )}
        </div>
      ))}
      <ShowAllToggle total={videos.length} shown={reveal.shown} expanded={reveal.expanded} onToggle={reveal.toggle} />
    </div>
  );
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

export function RenderedContentPreview({
  node,
  contentType,
  parsed,
}: {
  node: ContentTreeNode;
  contentType: ContentType | null;
  parsed: unknown;
}) {
  const data = parsed as any;
  const lang = data?.meta?.lang ?? node.cloudObject?.language;
  const dir = lang === "ar" ? "rtl" : "ltr";

  const body = (() => {
    switch (contentType) {
      case "quiz":
        return <QuizPreview data={data} r2Key={node.r2Key} />;
      case "bank":
        return <BankPreview data={data} r2Key={node.r2Key} />;
      case "written":
        return <WrittenPreview data={data} />;
      case "flashcard":
        return <FlashcardPreview data={data} />;
      case "osce":
        return <OscePreview data={data} r2Key={node.r2Key} />;
      case "video":
        return <VideoPreview data={data} />;
      default:
        return null;
    }
  })();

  if (!body) return null;
  return <div dir={dir} className="space-y-1.5">{body}</div>;
}

