"use client"

import * as React from "react"
import {
  Command as CommandPrimitive,
  CommandDialog,
  CommandEmpty as CmdkCommandEmpty,
  CommandGroup as CmdkCommandGroup,
  CommandInput as CmdkCommandInput,
  CommandItem as CmdkCommandItem,
  CommandList as CmdkCommandList,
  CommandSeparator as CmdkCommandSeparator,
} from "cmdk"
import { SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        "bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md",
        className
      )}
      {...props}
    />
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CmdkCommandInput>) {
  return (
    <div className="flex items-center border-b px-3" cmdk-input-wrapper="">
      <SearchIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
      <CmdkCommandInput
        className={cn(
          "placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CmdkCommandList>) {
  return (
    <CommandPrimitive.List
      className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CmdkCommandEmpty>) {
  return (
    <CommandPrimitive.Empty
      className={cn("py-6 text-center text-sm", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CmdkCommandGroup>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "text-foreground [&_[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium",
        className
      )}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CmdkCommandItem>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "aria-selected:bg-accent aria-selected:text-accent-foreground relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CmdkCommandSeparator>) {
  return (
    <CommandPrimitive.Separator
      className={cn("bg-border -mx-1 h-px", className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
}
