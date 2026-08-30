import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          // Premium primary: subtle elevation at rest, refined hover lift.
          "bg-primary text-primary-foreground shadow-e1 hover:bg-primary-hover hover:shadow-e2 active:shadow-e1 active:translate-y-px",
        destructive:
          "bg-destructive text-white shadow-e1 hover:bg-destructive/90 hover:shadow-e2 active:shadow-e1 active:translate-y-px focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border border-border-strong bg-background shadow-e1 hover:bg-accent hover:text-accent-foreground hover:border-primary/40 dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-e1 hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        xs: "h-7 rounded-md gap-1 px-2 text-xs has-[>svg]:px-1.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        iconSm: "size-7 rounded-md",
        iconXs: "size-6 rounded-md",
        iconLg: "size-10 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Show a spinner and disable the button. Useful for async submits. */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  // When `loading` is set, inject a spinner as the leading icon and
  // force-disable the button so the click handler can't fire twice.
  // If the button already has leading svg children, we still prepend the
  // spinner — the existing `[&_svg]:size-4` rule keeps sizing consistent.
  const content = (
    <>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </>
  )

  return (
    <Comp
      data-slot="button"
      data-loading={loading ? "true" : undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={loading || disabled}
      {...props}
    >
      {content}
    </Comp>
  )
}

export { Button, buttonVariants }
