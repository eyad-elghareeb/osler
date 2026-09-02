"use client";

import * as React from "react";
import { CheckCircle2, CirclePlay, Plus, Trash2, Tags } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StructuredEditorProps, Field, SectionLabel, ListToolbar, arrayMove, ItemRow, TagListField, MilkdownEditor } from "./shared";

/**
 * Structured content editors — full React port of
 * tauri-admin/frontend/views/content-editor.js.
 *
 * Each editor matches the full content schema (per-choice images, cloze
 * flashcards, OSCE patient/hiddenProfile/rubric, video YouTube-URL extraction
 * + chapters, written prompt children). Image references use the same
 * `images/<name>` convention as the student app — uploads land in the
 * content_object's R2 folder via the adminApi.uploadFile helper.
 */

export function extractYouTubeId(input: string): string {
  if (!input) return "";
  const s = String(input).trim();
  if (!s) return "";
  if (/^[a-zA-Z0-9_-]{8,32}$/.test(s)) return s;
  const short = s.match(/youtu\.be\/([a-zA-Z0-9_-]{8,32})/);
  if (short) return short[1];
  const watch = s.match(/[?&]v=([a-zA-Z0-9_-]{8,32})/);
  if (watch) return watch[1];
  const embed = s.match(/(?:embed|shorts|v)\/([a-zA-Z0-9_-]{8,32})/);
  if (embed) return embed[1];
  const fallback = s.match(/([a-zA-Z0-9_-]{11})/);
  return fallback ? fallback[1] : "";
}

export function youTubeThumb(id: string): string {
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}

export function VideoEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const dndScope = React.useId();
  const videos: any[] = Array.isArray(value?.videos) ? value.videos : [];

  function update(next: any[]) {
    onChange({ ...value, videos: next });
  }
  function addVideo() {
    update([
      ...videos,
      {
        id: `video-${String(Date.now()).slice(-6)}`,
        title: "",
        description: "",
        specialty: "",
        topic: "",
        duration: null,
        source: { type: "youtube", id: "" },
        instructor: "",
        tags: [],
        chapters: [],
        relatedArticles: [],
        lang: "en",
      },
    ]);
  }
  function patchVideo(i: number, patch: any) {
    update(videos.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }
  function removeVideo(i: number) {
    update(videos.filter((_, idx) => idx !== i));
  }
  function moveVideo(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= videos.length) return;
    const next = [...videos];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  }

  return (
    <div className="space-y-3">
      <ListToolbar onAdd={addVideo} addLabel={t("admin.structured.addVideo")} readOnly={readOnly} />
      {videos.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t("admin.structured.noVideos")}</p>
      ) : (
        videos.map((v, i) => {
          const source = v.source ?? { type: "youtube", id: "" };
          const ytId = source.type === "youtube" ? source.id : "";
          return (
            <ItemRow
              key={i}
              index={i}
              total={videos.length}
              onMove={(d) => moveVideo(i, d)}
              onRemove={() => removeVideo(i)}
              readOnly={readOnly}
              dragScope={dndScope}
              onDragReorder={(from, to) => update(arrayMove(videos, from, to))}
              title={`Video ${i + 1}: ${v.title || ""}`}
            >
              <Field label="ID">
                <Input
                  value={v.id ?? ""}
                  onChange={(e) => patchVideo(i, { id: e.target.value })}
                  readOnly={readOnly}
                  className="font-mono text-xs"
                  placeholder="ecg-interpretation"
                />
              </Field>
              <Field label="Title">
                <Input
                  value={v.title ?? ""}
                  onChange={(e) => patchVideo(i, { title: e.target.value })}
                  readOnly={readOnly}
                />
              </Field>
              <Field label="Description">
                <MilkdownEditor
  value={v.description ?? ""}
  onChange={(v) => patchVideo(i, { description: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Specialty">
                  <Input
                    value={v.specialty ?? ""}
                    onChange={(e) => patchVideo(i, { specialty: e.target.value })}
                    readOnly={readOnly}
                    placeholder="Cardiology"
                  />
                </Field>
                <Field label="Topic">
                  <Input
                    value={v.topic ?? ""}
                    onChange={(e) => patchVideo(i, { topic: e.target.value })}
                    readOnly={readOnly}
                    placeholder="ECG Interpretation"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Instructor">
                  <Input
                    value={v.instructor ?? ""}
                    onChange={(e) => patchVideo(i, { instructor: e.target.value })}
                    readOnly={readOnly}
                    placeholder="Dr. Sarah Chen, MD"
                  />
                </Field>
                <Field label="Duration (seconds)">
                  <Input
                    type="number"
                    value={v.duration ?? ""}
                    onChange={(e) => patchVideo(i, { duration: e.target.value === "" ? null : Number(e.target.value) })}
                    readOnly={readOnly}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Language">
                  <Select
                    value={v.lang ?? "en"}
                    onValueChange={(val) => patchVideo(i, { lang: val })}
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">{t("admin.structured.english")}</SelectItem>
                      <SelectItem value="ar">العربية</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Custom thumbnail URL (optional)">
                  <Input
                    value={v.thumbnail ?? ""}
                    onChange={(e) => patchVideo(i, { thumbnail: e.target.value })}
                    readOnly={readOnly}
                    placeholder="https://… — defaults to YouTube thumbnail"
                  />
                </Field>
              </div>

              <SectionLabel>{t("admin.structured.source")}</SectionLabel>
              <Field label="Source type">
                <Select
                  value={source.type ?? "youtube"}
                  onValueChange={(val) => {
                    const next = val === "youtube"
                      ? { type: "youtube", id: "" }
                      : { type: val, url: "" };
                    patchVideo(i, { source: next });
                  }}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="youtube">YouTube (paste any video URL or ID)</SelectItem>
                    <SelectItem value="mp4">Direct MP4 (CDN or same-origin URL)</SelectItem>
                    <SelectItem value="hls">HLS stream (.m3u8 URL)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {source.type === "youtube" ? (
                <Field label="YouTube URL or video ID">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <CirclePlay className="size-4 text-destructive shrink-0" />
                      <Input
                        value={source.id ?? ""}
                        onChange={(e) => {
                          const extracted = extractYouTubeId(e.target.value);
                          patchVideo(i, { source: { ...source, id: extracted || e.target.value.trim() } });
                        }}
                        readOnly={readOnly}
                        placeholder="Paste https://www.youtube.com/watch?v=… OR youtu.be/… OR dQw4w9WgXcQ"
                        className="font-mono text-xs"
                      />
                    </div>
                    {ytId ? (
                      <div className="flex items-center gap-2 text-xs text-success">
                        <CheckCircle2 className="size-3.5" />
                        <span>ID: {ytId}</span>
                        <img
                          src={youTubeThumb(ytId)}
                          alt={t("admin.structured.thumbnailPreview")}
                          className="h-12 rounded border border-border"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Paste a YouTube link above — {t("admin.structured.youtubeHint")}
                      </p>
                    )}
                  </div>
                </Field>
              ) : (
                <Field label="Stream URL">
                  <Input
                    value={source.url ?? ""}
                    onChange={(e) => patchVideo(i, { source: { ...source, url: e.target.value } })}
                    readOnly={readOnly}
                    placeholder="https://cdn.example.com/video.mp4"
                    className="font-mono text-xs"
                  />
                </Field>
              )}

              <SectionLabel>{t("admin.structured.chaptersOptional")}</SectionLabel>
              <ChaptersEditor
                chapters={v.chapters ?? []}
                onChange={(c) => patchVideo(i, { chapters: c })}
                readOnly={readOnly}
                r2KeyBase={r2KeyBase}
                rawR2Key={rawR2Key}
              />

              <SectionLabel>{t("admin.structured.tagsRelated")}</SectionLabel>
              <TagListField
                label="Tags"
                tags={v.tags ?? []}
                onChange={(t) => patchVideo(i, { tags: t })}
                readOnly={readOnly}
              />
              <TagListField
                label="Related articles (article keys)"
                tags={v.relatedArticles ?? []}
                onChange={(t) => patchVideo(i, { relatedArticles: t })}
                readOnly={readOnly}
                placeholder="cardiology/asthma.md"
              />
            </ItemRow>
          );
        })
      )}
    </div>
  );
}

export function ChaptersEditor({
  chapters,
  onChange,
  readOnly,
  r2KeyBase,
  rawR2Key,
}: {
  chapters: any[];
  onChange: (next: any[]) => void;
  readOnly?: boolean;
  r2KeyBase?: string;
  rawR2Key?: string;
}) {
  function add() {
    const lastTime = chapters.length ? chapters[chapters.length - 1].time : 0;
    onChange([...chapters, { time: (lastTime || 0) + 60, title: "" }]);
  }
  function patch(i: number, patch: any) {
    onChange(chapters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function remove(i: number) {
    onChange(chapters.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-1.5">
      {chapters.map((c, i) => (
        <div key={i} className="grid grid-cols-[100px_1fr_auto] gap-2 items-center">
          <Input
            type="number"
            value={c.time ?? 0}
            onChange={(e) => patch(i, { time: Number(e.target.value) })}
            readOnly={readOnly}
            placeholder="seconds"
            className="text-xs"
          />
          <Input
            value={c.title ?? ""}
            onChange={(e) => patch(i, { title: e.target.value })}
            readOnly={readOnly}
            placeholder="Chapter title"
            className="text-xs"
          />
          {!readOnly && (
            <Button
              size="iconSm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => remove(i)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button size="sm" variant="ghost" onClick={add} className="text-xs">
          <Plus className="size-3 me-1" /> Add chapter
        </Button>
      )}
    </div>
  );
}

// ── Written editor (with children) ─────────────────────────────────────────