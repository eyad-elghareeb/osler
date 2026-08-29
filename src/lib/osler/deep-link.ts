/**
 * Deep links for the global context menu.
 *
 * Content cards declare their canonical route via `data-ctx-link`
 * (a relative app path such as `/library?article=…`, produced by
 * `routeFor` / `routeForContentNode`). Right-clicking (or long-pressing)
 * anywhere inside such a card lets the context menu copy / share a link
 * that opens that exact content directly — not just the current page.
 */

import type { ContentTreeNode } from "./types";
import { routeFor } from "./navigation";

/**
 * Canonical route for a content-tree node, by engine type. Returns null for
 * video nodes: a videos-tree node is a *folder* that can hold several videos,
 * and `/videos?video=` matches the video resource id — so only video *cards*
 * (which know their resource id) can produce a deep link.
 */
export function routeForContentNode(node: Pick<ContentTreeNode, "type" | "uid">): string | null {
  switch (node.type) {
    case "library":
      return routeFor("library", { article: node.uid });
    case "flashcard":
      return routeFor("flashcards", { uid: node.uid });
    case "osce":
      return routeFor("osce", { uid: node.uid });
    case "video":
      return null;
    default:
      return routeFor("qbank", { uid: node.uid });
  }
}

export interface ResolvedContentLink {
  /** Absolute URL that opens the content directly. */
  href: string;
  /** Card-declared title (share text), when available. */
  title: string | null;
}

/** Read the `data-ctx-link` / `data-ctx-title` pair from the target's card. */
export function resolveContentLink(target: EventTarget | null): ResolvedContentLink | null {
  const el = target as HTMLElement | null;
  const holder = el?.closest?.("[data-ctx-link]") as HTMLElement | null;
  const path = holder?.getAttribute("data-ctx-link");
  if (!holder || !path) return null;
  return {
    href: new URL(path, window.location.origin).toString(),
    title: holder.getAttribute("data-ctx-title"),
  };
}

/** Mark an element as linkable; returns `{}` (no-op spread) when `link` is
 *  null/undefined so callers can spread unconditionally. */
export function ctxLinkAttrs(
  link: string | null | undefined,
  title?: string,
): { "data-ctx-link"?: string; "data-ctx-title"?: string } {
  if (!link) return {};
  return title
    ? { "data-ctx-link": link, "data-ctx-title": title }
    : { "data-ctx-link": link };
}
