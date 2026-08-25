"use client";

import * as React from "react";
import { Plus, Trash2, Tags } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StructuredEditorProps, Field, SectionLabel, ListToolbar, arrayMove, ItemRow, TagListField, ImageListField, MilkdownEditor } from "./shared";

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

export function FlashcardEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const dndScope = React.useId();
  if (Array.isArray(value?.decks)) {
    return <SubdecksEditor value={value} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }

  if (value?.front != null || value?.back != null) {
    return (
      <div className="space-y-3">
        <Field label="Front">
          <MilkdownEditor
  value={value.front ?? ""}
  onChange={(v) => onChange({ ...value, front: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
        </Field>
        <Field label="Back">
          <MilkdownEditor
  value={value.back ?? ""}
  onChange={(v) => onChange({ ...value, back: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
        </Field>
      </div>
    );
  }

  const cards: any[] = Array.isArray(value?.cards) ? value.cards : [];
  const subdecks: any[] = Array.isArray(value?.subdecks) ? value.subdecks : [];

  function updateCards(next: any[]) {
    onChange({ ...value, cards: next });
  }
  function addCard() {
    updateCards([
      ...cards,
      {
        id: `fc-${String(Date.now()).slice(-6)}`,
        front: "",
        back: "",
        tags: [],
      },
    ]);
  }
  function moveCard(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[i], next[j]] = [next[j], next[i]];
    updateCards(next);
  }
  function removeCard(i: number) {
    updateCards(cards.filter((_, idx) => idx !== i));
  }
  function patchCard(i: number, patch: any) {
    updateCards(cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function updateSubdecks(next: any[]) {
    onChange({ ...value, subdecks: next });
  }

  return (
    <div className="space-y-4">
      {/* Subdecks */}
      <div className="space-y-3">
        <SectionLabel>Subdecks ({subdecks.length})</SectionLabel>
        {subdecks.map((sd, i) => (
          <div key={i} className="border border-border rounded-xl p-3 space-y-2 bg-card/60">
            <div className="flex items-center gap-2">
              <Field label="ID">
                <Input
                  value={sd.id ?? ""}
                  onChange={(e) => updateSubdecks(subdecks.map((s, idx) => (idx === i ? { ...s, id: e.target.value } : s)))}
                  readOnly={readOnly}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Title">
                <Input
                  value={sd.title ?? ""}
                  onChange={(e) => updateSubdecks(subdecks.map((s, idx) => (idx === i ? { ...s, title: e.target.value } : s)))}
                  readOnly={readOnly}
                />
              </Field>
              {!readOnly && (
                <Button
                  size="iconSm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive mt-5"
                  onClick={() => updateSubdecks(subdecks.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => updateSubdecks([...subdecks, { id: `sd-${String(Date.now()).slice(-6)}`, title: "" }])}
            className="text-xs"
          >
            <Plus className="size-3 me-1" /> Add subdeck
          </Button>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        <SectionLabel>Cards ({cards.length})</SectionLabel>
        <ListToolbar onAdd={addCard} addLabel={t("admin.structured.addCard")} readOnly={readOnly} />
        {cards.map((c, i) => {
          const isCloze = (c.type ?? "basic") === "cloze";
          return (
            <ItemRow
              key={i}
              index={i}
              total={cards.length}
              onMove={(d) => moveCard(i, d)}
              onRemove={() => removeCard(i)}
              readOnly={readOnly}
              dragScope={dndScope}
              onDragReorder={(from, to) => updateCards(arrayMove(cards, from, to))}
              title={`Card ${i + 1}`}
            >
              <Field label="ID">
                <Input
                  value={c.id ?? ""}
                  onChange={(e) => patchCard(i, { id: e.target.value })}
                  readOnly={readOnly}
                  className="font-mono text-xs"
                  placeholder="fc-001"
                />
              </Field>
              <Field label="Type">
                <Select
                  value={c.type ?? "basic"}
                  onValueChange={(v) => patchCard(i, { type: v === "basic" ? undefined : v })}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">{t("admin.structured.basicFrontBack")}</SelectItem>
                    <SelectItem value="cloze">Cloze ({`{{c1::answer::hint}}`})</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {isCloze ? (
                <>
                  <Field label="Text" hint="Use {{c1::answer::hint}} for cloze deletions">
                    <MilkdownEditor
  value={c.text ?? ""}
  onChange={(v) => patchCard(i, { text: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
                  </Field>
                  <Field label="Extra (shown under answer)">
                    <MilkdownEditor
  value={c.extra ?? ""}
  onChange={(v) => patchCard(i, { extra: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Front">
                    <MilkdownEditor
  value={c.front ?? ""}
  onChange={(v) => patchCard(i, { front: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
                  </Field>
                  <Field label="Back">
                    <MilkdownEditor
  value={c.back ?? ""}
  onChange={(v) => patchCard(i, { back: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
                  </Field>
                </>
              )}
              <ImageListField
                label="Image (front)"
                images={c.image}
                onChange={(v) => patchCard(i, { image: v })}
                readOnly={readOnly}
                r2KeyBase={r2KeyBase}
                rawR2Key={rawR2Key}
              />
              <ImageListField
                label="Image (back)"
                images={c.backImage}
                onChange={(v) => patchCard(i, { backImage: v })}
                readOnly={readOnly}
                r2KeyBase={r2KeyBase}
                rawR2Key={rawR2Key}
              />
              <Field label="Audio">
                <Input
                  value={c.audio ?? ""}
                  onChange={(e) => patchCard(i, { audio: e.target.value || undefined })}
                  readOnly={readOnly}
                  placeholder="clip.mp3"
                />
              </Field>
              {subdecks.length > 0 && (
                <Field label="Subdeck">
                  <Select
                    value={c.subdeckId ?? ""}
                    onValueChange={(v) => patchCard(i, { subdeckId: v || undefined })}
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{t("common.none")}</SelectItem>
                      {subdecks.map((sd) => (
                        <SelectItem key={sd.id} value={sd.id}>{sd.title || sd.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <TagListField
                label="Tags"
                tags={c.tags ?? []}
                onChange={(v) => patchCard(i, { tags: v })}
                readOnly={readOnly}
              />
            </ItemRow>
          );
        })}
      </div>
    </div>
  );
}

export function SubdecksEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const dndScope = React.useId();
  const decks: any[] = Array.isArray(value?.decks) ? value.decks : [];
  function update(next: any[]) {
    onChange({ ...value, decks: next });
  }
  function addDeck() {
    update([...decks, { id: `deck-${decks.length + 1}`, name: t("admin.structured.newDeck"), cards: [] }]);
  }
  function patchDeck(i: number, patch: any) {
    update(decks.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }
  function removeDeck(i: number) {
    update(decks.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-3">
      <ListToolbar onAdd={addDeck} addLabel={t("admin.structured.addDeck")} readOnly={readOnly} />
      {decks.map((d, i) => (
        <ItemRow
          key={i}
          index={i}
          total={decks.length}
          onMove={() => {}}
          onRemove={() => removeDeck(i)}
          readOnly={readOnly}
          dragScope={dndScope}
          onDragReorder={(from, to) => update(arrayMove(decks, from, to))}
          title={`Deck ${i + 1}`}
        >
          <Field label="ID">
            <Input
              value={d.id ?? ""}
              onChange={(e) => patchDeck(i, { id: e.target.value })}
              readOnly={readOnly}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Name">
            <Input
              value={d.name ?? d.title ?? ""}
              onChange={(e) => patchDeck(i, { name: e.target.value, title: e.target.value })}
              readOnly={readOnly}
            />
          </Field>
          <Field label="Cards">
            <FlashcardEditor
              value={{ cards: d.cards ?? [] }}
              onChange={(v) => patchDeck(i, { cards: v.cards })}
              readOnly={readOnly}
              r2KeyBase={r2KeyBase}
              rawR2Key={rawR2Key}
            />
          </Field>
        </ItemRow>
      ))}
    </div>
  );
}

// ── OSCE editor (full schema: patient, hiddenProfile, rubric, questions) ───