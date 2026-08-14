"use client";

/**
 * MilkdownEditor — a reusable, controlled WYSIWYG markdown editor built on
 * Milkdown's Crepe flavor (https://milkdown.dev/docs/recipes/react).
 *
 * Why Milkdown?
 *   • Real WYSIWYG — text is rendered with formatting (bold, headings,
 *     lists, tables, code, links) as the user types, not just on blur.
 *   • Markdown in/out — `value` is markdown; the editor handles parsing and
 *     serializing internally via remark.
 *   • Battle-tested core (ProseMirror + Remark) — no custom cursor logic,
 *     no custom block model, no slash-palette crashes.
 *
 * Component contract:
 *   • `value: string` — markdown content (controlled input).
 *   • `onChange(next: string)` — fires on every keystroke with the updated
 *     markdown serialization of the document.
 *   • `placeholder?: string` — placeholder shown when the doc is empty.
 *   • `readOnly?: boolean` — toggles the editor between editable and
 *     read-only modes (live, no remount).
 *   • `className?: string` — wrapper class for layout / sizing.
 *
 * Implementation notes:
 *   • Crepe must be created inside a `MilkdownProvider` so the `useEditor`
 *     hook can mount it. We split into an inner editor component and an
 *     outer wrapper to keep that requirement transparent to consumers.
 *   • Crepe is created ONCE per mount (deps: []). External `value` updates
 *     are pushed into the editor via `replaceAll` to avoid recreating the
 *     ProseMirror doc tree on every keystroke — but only when the new
 *     markdown differs from what the editor already contains, so we don't
 *     fight the user's in-flight typing.
 *   • `onChange` is wired through Crepe's `listener.markdownUpdated` so
 *     the parent state stays in sync.
 *   • The `Crepe` instance is destroyed on unmount to prevent leaks.
 */

import * as React from "react";
import { Crepe } from "@milkdown/crepe";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { replaceAll } from "@milkdown/utils";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────

export interface MilkdownEditorProps {
  /** Markdown content to display/edit. */
  value: string;
  /** Called with the updated markdown on every change. */
  onChange: (next: string) => void;
  /** Placeholder text shown when the document is empty. */
  placeholder?: string;
  /** Read-only mode — disables editing without unmounting. */
  readOnly?: boolean;
  /** Optional className applied to the editor wrapper. */
  className?: string;
}

// ── Inner editor (must be a child of MilkdownProvider) ────────────────────

interface InnerEditorProps extends MilkdownEditorProps {
  /** Registers a ref to the Crepe instance so the wrapper can manage it. */
  registerCrepe: (crepe: Crepe | null) => void;
}

function InnerMilkdownEditor({
  value,
  onChange,
  placeholder,
  readOnly = false,
  registerCrepe,
}: InnerEditorProps) {
  // Keep the latest onChange in a ref so the editor's listener always calls
  // the freshest callback without recreating the editor.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  // Keep the latest placeholder in a ref so we can update the Crepe config
  // without recreating the editor.
  const placeholderRef = React.useRef(placeholder);
  placeholderRef.current = placeholder;

  // Track the markdown the editor currently holds, so external `value`
  // updates can be compared against it without round-tripping through
  // `getMarkdown()` (which would re-serialize on every keystroke).
  const lastAppliedRef = React.useRef<string>(value);

  // Hold the Crepe instance in a local ref. The `useEditor` hook's `get()`
  // function is typed as `() => Editor | undefined`, but at runtime it
  // returns whatever we returned from the factory — in our case, a `Crepe`
  // (which extends `CrepeBuilder`, not `Editor`). Keeping our own typed ref
  // lets us call `Crepe`-specific methods like `setReadonly()` without
  // fighting the type system.
  const crepeRef = React.useRef<Crepe | null>(null);

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: value,
      features: {
        // Disable the AI feature — it requires backend credentials and
        // is not relevant to written medical answers.
        [Crepe.Feature.AI]: false,
        // Disable TopBar (the always-visible toolbar at the top of the
        // editor) — we keep the inline Toolbar (selection-aware bubble)
        // and the slash menu, which give a cleaner UX in a compact
        // answer field.
        [Crepe.Feature.TopBar]: false,
        // Keep the rest of the features on for a rich WYSIWYG experience.
        [Crepe.Feature.CodeMirror]: true,
        [Crepe.Feature.ListItem]: true,
        [Crepe.Feature.LinkTooltip]: true,
        [Crepe.Feature.Cursor]: true,
        [Crepe.Feature.ImageBlock]: true,
        [Crepe.Feature.BlockEdit]: true,
        [Crepe.Feature.Toolbar]: true,
        [Crepe.Feature.Placeholder]: true,
        [Crepe.Feature.Table]: true,
        [Crepe.Feature.Latex]: true,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: placeholder ?? "Write your answer…",
          mode: "block",
        },
      },
    });

    // Wire markdown updates → onChange. Crepe's listener manager handles
    // the subscription lifecycle automatically.
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        lastAppliedRef.current = markdown;
        onChangeRef.current(markdown);
      });
    });

    // Hand the instance back to the wrapper for readonly/lifecycle control.
    registerCrepe(crepe);
    // Also stash it in the local ref so the effects below can call
    // `Crepe`-specific methods without going through `get()` (which is
    // typed as `Editor | undefined`).
    crepeRef.current = crepe;

    return crepe;
  }, []);

  // Push external `value` updates into the editor when they don't match
  // what the editor already holds (e.g. camera transcription, undo/redo,
  // programmatic set). This avoids clobbering the user's caret position
  // during normal typing — `lastAppliedRef` is updated by the listener
  // whenever the editor itself changes the doc, so a matching value is a
  // no-op.
  React.useEffect(() => {
    const crepe = crepeRef.current;
    if (!crepe) return;
    if (value === lastAppliedRef.current) return;
    // Replace the entire document with the new markdown atomically.
    // Crepe exposes the underlying `Editor` via `.editor`; the `action`
    // method lives on the Editor, not on Crepe itself.
    try {
      crepe.editor.action(replaceAll(value));
      lastAppliedRef.current = value;
    } catch (error) {
      // Fallback: just record the value so we don't loop.
      lastAppliedRef.current = value;
      console.warn("[MilkdownEditor] Failed to apply external value:", error);
    }
  }, [value]);

  // Toggle read-only mode without recreating the editor.
  React.useEffect(() => {
    const crepe = crepeRef.current;
    if (!crepe) return;
    crepe.setReadonly(readOnly);
  }, [readOnly]);

  return <Milkdown />;
}

// ── Outer wrapper — owns the Crepe instance lifecycle ─────────────────────

export function MilkdownEditor(props: MilkdownEditorProps) {
  const crepeRef = React.useRef<Crepe | null>(null);

  const registerCrepe = React.useCallback((crepe: Crepe | null) => {
    crepeRef.current = crepe;
  }, []);

  // Destroy the Crepe instance on unmount to prevent memory leaks.
  React.useEffect(() => {
    return () => {
      const crepe = crepeRef.current;
      if (!crepe) return;
      crepe.destroy().catch((error) => {
        console.warn("[MilkdownEditor] Failed to destroy editor:", error);
      });
      crepeRef.current = null;
    };
  }, []);

  return (
    <MilkdownProvider>
      <div
        className={cn(
          "osler-milkdown-editor rounded-lg border border-border bg-card overflow-hidden",
          "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20 transition-colors",
          props.className,
        )}
      >
        <InnerMilkdownEditor
          value={props.value}
          onChange={props.onChange}
          placeholder={props.placeholder}
          readOnly={props.readOnly}
          registerCrepe={registerCrepe}
        />
      </div>
    </MilkdownProvider>
  );
}

export default MilkdownEditor;
