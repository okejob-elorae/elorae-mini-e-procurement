"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Tema terang: garis dan isi memakai warna teks (foreground). Warna primer
 * (lime) di atas latar krem hanya ±1,6:1 — kotak yang dicentang tampak tidak
 * berubah, dan yang kosong (border-input ±1,2:1) tidak terlihat sama sekali.
 * Tema gelap tetap memakai warna primer.
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-foreground/45 dark:border-input dark:bg-input/30 data-[state=checked]:bg-foreground data-[state=checked]:text-background data-[state=checked]:border-foreground dark:data-[state=checked]:bg-primary dark:data-[state=checked]:text-primary-foreground dark:data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
