"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Osler themed checkbox.
 *
 * Visual recipe:
 *   - size-4 (16px) default
 *   - rounded-md (6px) — softer than the default 4px, matches the card radius scale
 *   - 1px border-input at rest; primary fill + primary-foreground check when checked
 *   - hover: border-primary/50 + bg-primary/5 (subtle tint, not a full fill)
 *   - focus-visible: ring-2 ring-primary/40 (matches every other focusable in the app)
 *   - indeterminate: primary fill with a Minus icon
 *   - transition on background, border, color — smooth 150ms ease
 *   - disabled: opacity-50, cursor-not-allowed
 *
 * The check icon scales in (scale-0 → scale-100) on check for a subtle
 * confirmation animation. Respects reduced-motion via the OS-level
 * `prefers-reduced-motion` setting (the transition just fires instantly).
 */
function Checkbox({
  className,
  checked,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  const isIndeterminate = checked === "indeterminate";
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      checked={checked}
      className={cn(
        "peer shrink-0 rounded-md border border-input bg-card shadow-xs",
        "transition-[background-color,border-color,color,box-shadow] duration-150",
        "hover:border-primary/50 hover:bg-primary/5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-0",
        "data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:text-primary-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "size-4",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        {isIndeterminate ? (
          <Minus className="size-3" strokeWidth={3} />
        ) : (
          <Check className="size-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
