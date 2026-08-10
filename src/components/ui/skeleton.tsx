import { cn } from "@/lib/utils"

/**
 * Skeleton — premium shimmer loading placeholder.
 *
 * Upgraded from the default shadcn `animate-pulse` recipe to a 21st.dev-
 * inspired shimmer sweep that reads as "content arriving" rather than a
 * flat pulse. Honours `prefers-reduced-motion` and the user's animations
 * toggle via the `.osler-skeleton` CSS class (see `globals.css`).
 *
 * Pattern source: `docs/design-library-roadmap.md` § "21st.dev — curated
 * discovery source" (loaders, inputs, command UI, small details).
 *
 * Usage:
 *   <Skeleton className="h-4 w-32" />           // default shimmer
 *   <Skeleton variant="solid" className="h-4" /> // flat tint (no sweep)
 */
function Skeleton({
  className,
  /** `shimmer` (default) sweeps a highlight; `solid` is a flat tinted block. */
  variant = "shimmer",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "shimmer" | "solid";
}) {
  return (
    <div
      data-slot="skeleton"
      data-variant={variant}
      className={cn(
        variant === "shimmer" ? "osler-skeleton" : "bg-accent animate-pulse",
        "rounded-md",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
