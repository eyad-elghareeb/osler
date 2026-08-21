"use client";

/**
 * Shared markdown renderer for AI-generated chat content — AI assistant
 * bubbles, OSCE patient/examiner replies, and debrief feedback.
 *
 * Uses the project's existing react-markdown + remark-gfm stack so model
 * answers get real GFM rendering (tables, task lists, strikethrough,
 * autolinks) instead of the hand-rolled regex converters that only
 * covered a subset. Raw HTML in model output is intentionally NOT
 * rendered (no rehype-raw): react-markdown escapes it, so injected
 * markup can never execute. Typography lives in the `.ai-chat-msg`
 * scope in globals.css.
 */

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export function AiMarkdown({ text, className, writing }: { text: string; className?: string; writing?: boolean }) {
  return (
    <div className={cn("ai-chat-msg", writing && "is-writing", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ node, children, ...props }) {
            return (
              <a {...props} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
