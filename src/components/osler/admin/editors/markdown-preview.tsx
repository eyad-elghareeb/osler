"use client";

/**
 * Shared rendered-markdown preview used by the content editor's article
 * preview and the MarkdownEditor's preview / split views. Encapsulates the
 * exact preview recipe (`.preview-md` typography, frontmatter stripping,
 * mermaid rendering, image resolution) so every surface renders identically.
 */

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/components/osler/i18n-provider";
import { resolveImageForPreview } from "@/components/osler/admin/editors/image-upload";

// ── Frontmatter ────────────────────────────────────────────────────────────

export function parseFrontmatter(md: string): { body: string } {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") return { body: md };
  let end = 1;
  while (end < lines.length && lines[end]?.trim() !== "---") end++;
  return { body: lines.slice(end + 1).join("\n").trim() };
}

// ── Typography ─────────────────────────────────────────────────────────────

export const PREVIEW_MARKDOWN_STYLES = `
  .preview-md { color: var(--foreground); font-size: 0.9rem; line-height: 1.65; unicode-bidi: plaintext; }
  .preview-md h1 { font-size: 1.75rem; font-weight: 700; margin: 1.5rem 0 0.75rem; color: var(--foreground); }
  .preview-md h2 { font-size: 1.4rem; font-weight: 600; margin: 1.25rem 0 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; color: var(--foreground); }
  .preview-md h3 { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.4rem; color: var(--foreground); }
  .preview-md p { margin: 0.6rem 0; line-height: 1.7; }
  .preview-md ul, .preview-md ol { padding-inline-start: 1.5rem; margin: 0.5rem 0; }
  .preview-md li { margin: 0.2rem 0; }
  .preview-md blockquote { border-inline-start: 3px solid var(--info); background: color-mix(in oklch, var(--info) 10%, transparent); margin: 0.75rem 0; padding: 0.5rem 1rem; border-radius: 0 0.25rem 0.25rem 0; }
  .preview-md code { font-family: var(--font-geist-mono), ui-monospace, monospace; background: var(--muted); color: var(--foreground); padding: 0.15rem 0.35rem; border-radius: 0.25rem; font-size: 0.85em; }
  .preview-md pre { background: var(--muted); color: var(--foreground); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.75rem 0; }
  .preview-md pre code { background: transparent; padding: 0; }
  .preview-md table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
  .preview-md th, .preview-md td { border: 1px solid var(--border); padding: 0.4rem 0.6rem; text-align: start; font-size: 0.9em; color: var(--foreground); }
  .preview-md th { background: var(--muted); font-weight: 600; color: var(--foreground); }
  .preview-md img { max-width: 100%; border-radius: 0.5rem; margin: 0.75rem 0; }
  .preview-md hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
  .preview-md a { color: var(--primary); text-decoration: underline; }
  .preview-md--compact { font-size: 0.82rem; line-height: 1.5; }
  .preview-md--compact h1 { font-size: 1.05rem; margin: 0.5rem 0 0.3rem; }
  .preview-md--compact h2 { font-size: 0.95rem; margin: 0.4rem 0 0.25rem; }
  .preview-md--compact h3 { font-size: 0.88rem; margin: 0.35rem 0 0.2rem; }
  .preview-md--compact p { margin: 0.25rem 0; }
  .preview-md--compact ul, .preview-md--compact ol { margin: 0.25rem 0; }
  .preview-md--compact li { margin: 0.1rem 0; }
  .preview-md--compact blockquote { margin: 0.35rem 0; padding: 0.3rem 0.6rem; }
  .preview-md--compact pre { padding: 0.6rem; margin: 0.35rem 0; }
  .preview-md--compact code { font-size: 0.8em; }
  .preview-md--compact th, .preview-md--compact td { padding: 0.25rem 0.4rem; font-size: 0.82em; }
  .preview-md--compact img { margin: 0.35rem 0; }
`;

// ── Mermaid ────────────────────────────────────────────────────────────────

function MermaidPreviewBlock({ code }: { code: string }) {
  const { t } = useI18n();
  const [svg, setSvg] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("mermaid");
        const m = mod.default;
        m.initialize({
          startOnLoad: false,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
          securityLevel: "strict",
        });
        const id = `preview-md-${Math.random().toString(36).slice(2, 10)}`;
        const { svg: out } = await m.render(id, code.trim());
        if (!cancelled) { setSvg(out); setError(""); }
        document.getElementById(id)?.remove();
      } catch (err: any) {
        if (!cancelled) setError(String(err?.message ?? err));
      }
    })();
    return () => { cancelled = true; };
  }, [code]);
  if (error) {
    return <pre className="bg-destructive/10 text-destructive p-2 rounded text-xs">{t("admin.content.mermaidError", { error, code })}</pre>;
  }
  if (!svg) return <div className="text-xs text-muted-foreground p-4 text-center">{t("admin.content.renderingDiagram")}</div>;
  return <div dangerouslySetInnerHTML={{ __html: svg }} className="my-4 [&_svg]:max-w-full [&_svg]:h-auto" />;
}

// ── Component ──────────────────────────────────────────────────────────────

export function MarkdownPreview({
  body,
  r2KeyBase,
  rawR2Key,
}: {
  body: string;
  r2KeyBase?: string;
  rawR2Key?: string;
}) {
  return (
    <>
      <style>{PREVIEW_MARKDOWN_STYLES}</style>
      <article className="preview-md max-w-3xl mx-auto">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Render mermaid code blocks as inline SVG via the mermaid dep.
            code({ inline, className, children, ...props }: any) {
              const text = String(children);
              if (!inline && className === "language-mermaid") {
                return <MermaidPreviewBlock code={text} />;
              }
              return <code className={className} {...props}>{children}</code>;
            },
            // Resolve relative image refs (images/foo.png, foo.png) to
            // URLs the admin can preview via the local R2 proxy.
            img({ src, alt, ...props }: any) {
              const resolved = resolveImageForPreview(String(src ?? ""), { r2KeyBase, rawR2Key });
              return (
                <img
                  src={resolved}
                  alt={alt}
                  {...props}
                  onError={(e) => {
                    // Hide broken images rather than showing the browser
                    // broken-image icon — the user can still see the alt text
                    // and the markdown source.
                    (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                  }}
                />
              );
            },
          }}
        >
          {parseFrontmatter(body).body}
        </ReactMarkdown>
      </article>
    </>
  );
}
