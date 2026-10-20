"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { buildColorIndex, colorMatchKey } from "@elorae/db/variant-axes";
import { addVariantColorFromItemForm, getPantoneOptionsForItems } from "@/app/actions/variant-colors";
import type { VariantColorOption } from "@/lib/items/variant-colors";
import { replaceColorLabel } from "@/lib/items/normalize-variants";
import {
  PantoneThemePickerDialog,
  type PantoneThemeSelection,
} from "@/components/settings/PantoneThemePickerDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function Swatch({ hex }: { hex?: string | null }) {
  return (
    <span
      className="h-3.5 w-3.5 shrink-0 rounded-full border"
      style={hex ? { backgroundColor: hex } : undefined}
      aria-hidden
    />
  );
}

type Draft = { name: string; pantone: PantoneThemeSelection | null; alias: string | null };

/**
 * Warna of a finished good: colours from the colour master (#437), each optionally a Pantone.
 * Ops add a missing one here by name, by Pantone, or both. `values` are colour labels as stored
 * on the variants; a label no master colour spells is shown as unmatched so ops can add it.
 */
export function VariantColorPicker({
  values,
  onChange,
  options,
  loadFailed = false,
  onColorAdded,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: VariantColorOption[] | null;
  loadFailed?: boolean;
  onColorAdded: (color: VariantColorOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pantoneOpen, setPantoneOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const index = useMemo(() => buildColorIndex(options ?? []), [options]);
  const byId = useMemo(() => new Map((options ?? []).map((c) => [c.id, c])), [options]);
  const selectedIds = new Set(values.map((v) => index.get(colorMatchKey(v))).filter(Boolean));

  const q = query.trim();
  const filtered = (options ?? []).filter(
    (c) =>
      !selectedIds.has(c.id) &&
      (!q || [c.name, ...c.aliases, c.pantone?.tcx ?? ""].some((t) => t.toLowerCase().includes(q.toLowerCase())))
  );
  const exactMatch = q ? index.has(colorMatchKey(q)) : false;

  const pick = (label: string) => {
    if (!values.some((v) => colorMatchKey(v) === colorMatchKey(label))) onChange([...values, label]);
    setQuery("");
  };

  const openDraft = (name: string, alias: string | null = null) => {
    setOpen(false);
    setDraft({ name, pantone: null, alias });
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim() && !draft.pantone) {
      toast.error("Type a colour name or choose a Pantone");
      return;
    }
    setSaving(true);
    try {
      const result = await addVariantColorFromItemForm({
        name: draft.name,
        pantoneTcx: draft.pantone?.tcx ?? null,
        alias: draft.alias,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { color, reused } = result;
      onColorAdded(color);
      if (reused) toast.info(`Using existing colour "${color.name}"`);
      if (draft.alias) {
        const nextIndex = buildColorIndex([...(options ?? []).filter((c) => c.id !== color.id), color]);
        // An unmatched label that now resolves (as an alias) stays, so its variant SKUs stay put.
        if (nextIndex.get(colorMatchKey(draft.alias)) !== color.id) {
          onChange(replaceColorLabel(values, draft.alias, color.name));
        }
      } else {
        pick(color.name);
      }
      setDraft(null);
    } catch (err) {
      console.error("addVariantColorFromItemForm failed", err);
      toast.error(err instanceof Error ? err.message : "Failed to add colour");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-9 w-full flex-wrap items-center gap-2 rounded-md border px-2 py-1.5">
      {values.map((label) => {
        const color = byId.get(index.get(colorMatchKey(label)) ?? "");
        const unmatched = options != null && !color;
        return (
          <span
            key={label}
            className={
              unmatched
                ? "flex items-center gap-1.5 rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-xs"
                : "flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs"
            }
            title={unmatched ? "Not in the colour master" : color?.pantone ? `Pantone ${color.pantone.tcx}` : undefined}
          >
            {unmatched ? <AlertTriangle className="h-3 w-3 text-amber-600" aria-hidden /> : <Swatch hex={color?.pantone?.hex} />}
            {label}
            {unmatched && (
              <button type="button" className="font-medium underline" onClick={() => openDraft(label, label)}>
                Add
              </button>
            )}
            <button
              type="button"
              aria-label={`Remove ${label}`}
              className="opacity-60 hover:opacity-100"
              onClick={() => onChange(values.filter((v) => v !== label))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}

      {loadFailed ? (
        <span className="text-xs text-destructive">Colour master failed to load; reload the page.</span>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" disabled={options == null}>
              {options == null ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
              Add colour
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="Search colour or Pantone code…" value={query} onValueChange={setQuery} />
              <CommandList>
                <CommandEmpty>No colour found.</CommandEmpty>
                <CommandGroup>
                  {filtered.slice(0, 100).map((c) => (
                    <CommandItem key={c.id} value={c.id} onSelect={() => pick(c.name)}>
                      <Swatch hex={c.pantone?.hex} />
                      <span className="truncate">{c.name}</span>
                      {c.pantone && <span className="ml-auto text-xs text-muted-foreground">{c.pantone.tcx}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {!exactMatch && (
                  <CommandGroup>
                    <CommandItem value="__new__" onSelect={() => openDraft(q)}>
                      <Plus className="h-4 w-4" />
                      {q ? `New colour “${q}”` : "New colour…"}
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      <Dialog open={draft != null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New colour</DialogTitle>
            <DialogDescription>
              Type a name, choose a Pantone, or both. It joins the colour master (Production → Colors).
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-colour-name">Name</Label>
                <Input
                  id="new-colour-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder={draft.pantone?.name ?? "e.g. Army"}
                />
              </div>
              <div className="space-y-2">
                <Label>Pantone (optional)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {draft.pantone && (
                    <span className="flex items-center gap-2 text-sm">
                      <span className="h-5 w-5 rounded border" style={{ backgroundColor: draft.pantone.hex }} aria-hidden />
                      {draft.pantone.tcx} · {draft.pantone.name}
                    </span>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => setPantoneOpen(true)}>
                    {draft.pantone ? "Change" : "Choose Pantone"}
                  </Button>
                  {draft.pantone && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Clear Pantone"
                      onClick={() => setDraft({ ...draft, pantone: null })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Left blank, the name is taken from the Pantone.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveDraft} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add colour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PantoneThemePickerDialog
        open={pantoneOpen}
        onOpenChange={setPantoneOpen}
        onSelect={(p) => setDraft((d) => (d ? { ...d, pantone: p } : d))}
        load={getPantoneOptionsForItems}
        description="Search by name, TCX code, or hex."
      />
    </div>
  );
}
