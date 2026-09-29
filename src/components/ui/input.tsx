import { Input as InputPrimitive } from "@base-ui/react/input"
import * as React from "react"

import { cn } from "@/lib/utils"

// NOTE: wrapped in forwardRef deliberately. The upstream shadcn source is written
// for React 19 (where `ref` is an ordinary prop); this project is on React 18.3.1,
// which DROPS `ref` from function components — every consumer ref read back null.
// That silently broke ⌘F (focus stayed in the document and the query was typed into
// the user's content), inline rename, and prompt-dialog autofocus. Keep the
// forwardRef when regenerating this file until the project moves to React 19.
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function Input({ className, type, ...props }, ref) {
  return (
    <InputPrimitive
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        "border-input bg-card selection:bg-primary dark:bg-input/30 selection:text-primary-foreground ring-offset-input placeholder:text-muted-foreground flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
})

export { Input }
