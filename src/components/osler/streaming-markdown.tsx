"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReducedMotion } from "framer-motion";
import { AiMarkdown } from "@/components/osler/ai-markdown";

/* ── Word-reveal timing ───────────────────────────────────────────────
 * Mirrors transitions.dev P30 Streaming text:
 *  gap 60ms between words, each word fades + unblurs over 350ms
 *  (the CSS in globals.css — .t-stream-w — defines the visual).
 */

const WORD_GAP_MS = 60;

function useWordReveal(total: number, enabled: boolean): number {
  const reduce = useReducedMotion();
  const shouldAnimate = enabled && !reduce;
  const [visible, setVisible] = React.useState(() => (shouldAnimate ? 0 : total));
  const visibleRef = React.useRef(visible);
  const totalRef = React.useRef(total);
  const enabledRef = React.useRef(shouldAnimate);

  React.useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  React.useEffect(() => {
    totalRef.current = total;
  }, [total]);
  React.useEffect(() => {
    enabledRef.current = shouldAnimate;
  }, [shouldAnimate]);

  // Sync when animation is disabled or reduced-motion is on.
  React.useEffect(() => {
    if (!shouldAnimate) {
      if (visibleRef.current !== total) {
        visibleRef.current = total;
        setVisible(total);
      }
      return;
    }
    // New message shrank (e.g. chat cleared / new bubble) — reset.
    if (total < visibleRef.current) {
      visibleRef.current = 0;
      setVisible(0);
    }
    if (visibleRef.current >= total) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        if (!enabledRef.current) return;
        if (visibleRef.current < totalRef.current) {
          visibleRef.current += 1;
          setVisible(visibleRef.current);
          if (visibleRef.current < totalRef.current) schedule();
        }
      }, WORD_GAP_MS);
    };
    schedule();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [shouldAnimate, total]);

  // Also instantly finish when animation is turned off mid-stream
  // (e.g. user toggles reduced-motion while a reply is revealing).
  React.useEffect(() => {
    if (!shouldAnimate && visible !== total) setVisible(total);
  }, [shouldAnimate, total, visible]);

  return visible;
}

export function StreamingMarkdown({
  text,
  animate,
}: {
  text: string;
  animate: boolean;
}) {
  const reduce = useReducedMotion();
  const enabled = animate && !reduce;

  const total = React.useMemo(() => {
    const t = text.trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  }, [text]);

  const visible = useWordReveal(total, enabled);
  const revealing = enabled && visible < total;

  // Wrap counter is local to this render — reset to 0 so the first word
  // in the document is index 0, next is 1, etc. This hook must run
  // before any early return so the hook order stays stable.
  const idxRef = React.useRef(0);
  idxRef.current = 0;

  // No animation — delegate to the battle-tested markdown renderer.
  if (!enabled) {
    return <AiMarkdown text={text} />;
  }

  // Recursively walk a React node tree, splitting every string leaf into
  // word-level <span class="t-stream-w"> elements. Code/pre blocks are
  // left untouched (they should appear instantly). Links keep their href
  // but their label text gets the same word treatment.
  function wrapChildren(children: React.ReactNode): React.ReactNode {
    const arr = React.Children.toArray(children);
    // Explicit ReactNode return: pass-through branches return the raw child,
    // and TS7's stricter flatMap typing no longer infers that union itself.
    return arr.flatMap((child): React.ReactNode => {
      if (typeof child === "string") {
        const parts = (child as string).split(/(\s+)/);
        return parts.map((part, i) => {
          if (part === "" || /^\s+$/.test(part)) return part;
          const wIdx = idxRef.current++;
          const isIn = wIdx < visible;
          return (
            <span key={`${wIdx}-${i}`} className={isIn ? "t-stream-w is-in" : "t-stream-w"}>
              {part}
            </span>
          );
        });
      }
      if (React.isValidElement(child)) {
        const props = (child as React.ReactElement<{ children?: React.ReactNode }>).props;
        const type = (child as React.ReactElement).type;
        const tag = typeof type === "string" ? (type as string) : "";
        if (tag === "code" || tag === "pre") return child;
        if (props.children != null) {
          const newChildren = wrapChildren(props.children);
          const extra: Record<string, unknown> = {};
          if (tag === "a") {
            extra.target = "_blank";
            extra.rel = "noopener noreferrer";
          }
          return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
            ...extra,
            children: newChildren,
          } as never);
        }
        return child;
      }
      return child;
    });
  }

  // Only block-level containers need a custom renderer — inline elements
  // (strong, em, a, etc.) are handled recursively by wrapChildren when
  // they appear inside a block.
  const components: Record<string, React.FC<{ children?: React.ReactNode } & Record<string, unknown>>> = {
    p: ({ children, ...props }) => <p {...props}>{wrapChildren(children)}</p>,
    li: ({ children, ...props }) => <li {...props}>{wrapChildren(children)}</li>,
    h1: ({ children, ...props }) => <h1 {...props}>{wrapChildren(children)}</h1>,
    h2: ({ children, ...props }) => <h2 {...props}>{wrapChildren(children)}</h2>,
    h3: ({ children, ...props }) => <h3 {...props}>{wrapChildren(children)}</h3>,
    h4: ({ children, ...props }) => <h4 {...props}>{wrapChildren(children)}</h4>,
    blockquote: ({ children, ...props }) => <blockquote {...props}>{wrapChildren(children)}</blockquote>,
    td: ({ children, ...props }) => <td {...props}>{wrapChildren(children)}</td>,
    th: ({ children, ...props }) => <th {...props}>{wrapChildren(children)}</th>,
  };

  return (
    <div className={revealing ? "ai-chat-msg is-writing" : "ai-chat-msg"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as unknown as React.ComponentProps<typeof ReactMarkdown>["components"]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
