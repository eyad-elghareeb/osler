"use client";

import * as React from "react";
import { StickyNote, X } from "lucide-react";

export interface StickyNoteData {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
}

const STICKY_COLORS = [
  "#fef08a", // yellow
  "#bbf7d0", // green
  "#bfdbfe", // blue
  "#fbcfe8", // pink
  "#fed7aa", // orange
];

export function StickyNoteCard({
  note,
  readOnly,
  onUpdate,
  onDelete,
  onMove,
}: {
  note: StickyNoteData;
  readOnly?: boolean;
  onUpdate: (text: string) => void;
  onDelete: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const [localText, setLocalText] = React.useState(note.text);
  const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef({ startX: 0, startY: 0, noteX: 0, noteY: 0 });

  // Reset state when note id changes
  React.useEffect(() => {
    setLocalText(note.text);
    setDragOffset({ x: 0, y: 0 });
  }, [note.id, note.text]);

  const handleBlur = () => {
    setEditing(false);
    if (localText !== note.text) onUpdate(localText);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (editing) return;
    const startX = e.clientX,
      startY = e.clientY;
    const noteX = note.x,
      noteY = note.y;
    dragRef.current = { startX, startY, noteX, noteY };

    const handleMouseMove = (e: MouseEvent) => {
      setDragOffset({ x: e.clientX - startX, y: e.clientY - startY });
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      const finalX = noteX + (upEvent.clientX - startX);
      const finalY = noteY + (upEvent.clientY - startY);
      setDragOffset({ x: 0, y: 0 });
      onMove(finalX, finalY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      className="fixed z-50 rounded-xl shadow-lg border border-black/10 backdrop-blur-sm select-none"
      style={{
        backgroundColor: note.color,
        width: 220,
        minHeight: 100,
        left: note.x + dragOffset.x,
        top: note.y + dragOffset.y,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="flex items-center justify-between px-2 py-1 rounded-t-xl cursor-grab active:cursor-grabbing">
        <StickyNote className="size-3 text-black/30" />
        <button
          onClick={onDelete}
          disabled={readOnly}
          className="size-5 rounded hover:bg-black/10 flex items-center justify-center transition-colors disabled:opacity-30"
        >
          <X className="size-3" />
        </button>
      </div>
      {editing && !readOnly ? (
        <textarea
          ref={textRef}
          autoFocus
          value={localText}
          onChange={(e) => setLocalText(e.target.value)}
          onBlur={handleBlur}
          className="w-full bg-transparent text-xs text-gray-800 px-3 pb-3 outline-none resize-none"
          style={{ minHeight: 60 }}
          placeholder="Type your note..."
        />
      ) : (
        <div
          className="px-3 pb-3 text-xs text-gray-800 whitespace-pre-wrap break-words cursor-text"
          style={{ minHeight: 60 }}
          onClick={() => {
            if (!readOnly) {
              setEditing(true);
              setTimeout(() => textRef.current?.focus(), 0);
            }
          }}
        >
          {localText || (
            <span className="italic text-black/30">Click to type...</span>
          )}
        </div>
      )}
    </div>
  );
}

export { STICKY_COLORS };
