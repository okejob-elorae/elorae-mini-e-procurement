"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { TagsInput } from "@/components/ui/tags-input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveVariantColorAction } from "@/app/actions/variant-colors";
import type { UnresolvedColorRow, VariantColorRow } from "@/lib/items/variant-colors";

export type VariantColorsProps = {
  colors: VariantColorRow[];
  unresolved: UnresolvedColorRow[];
  canEdit: boolean;
};

type Draft = { id: string | null; name: string; pantoneTcx: string; aliases: string[]; isActive: boolean };

/** Colour master for finished-good variants (#437): name, Pantone link and the spellings it answers to. */
export function VariantColorsClient({ colors, unresolved, canEdit }: VariantColorsProps) {
  const t = useTranslations("productionColors.product");
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [mapTarget, setMapTarget] = useState<Record<string, string>>({});

  const save = async (id: string | null, input: Omit<Draft, "id">) => {
    setSaving(true);
    try {
      const res = await saveVariantColorAction(id, {
        name: input.name,
        pantoneTcx: input.pantoneTcx || null,
        aliases: input.aliases,
        isActive: input.isActive,
      });
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      toast.success(t("saved"));
      router.refresh();
      return true;
    } finally {
      setSaving(false);
    }
  };

  const mapAsAlias = async (label: string) => {
    const color = colors.find((c) => c.id === mapTarget[label]);
    if (!color) return;
    await save(color.id, {
      name: color.name,
      pantoneTcx: color.pantone?.tcx ?? "",
      aliases: [...color.aliases, label],
      isActive: color.isActive,
    });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      {unresolved.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("unresolvedTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("variantText")}</TableHead>
                  <TableHead>{t("usage")}</TableHead>
                  {canEdit && <TableHead>{t("resolve")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {unresolved.map((u) => (
                  <TableRow key={u.label}>
                    <TableCell className="font-medium">
                      {u.label}
                      <div className="text-xs text-muted-foreground">{u.sampleSkus.join(", ")}</div>
                    </TableCell>
                    <TableCell>{t("usageValue", { items: u.itemCount, variants: u.variantCount })}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDraft({ id: null, name: u.label, pantoneTcx: "", aliases: [], isActive: true })}
                          >
                            {t("addAsColor")}
                          </Button>
                          <SearchableCombobox
                            options={colors.map((c) => ({ value: c.id, label: c.name }))}
                            value={mapTarget[u.label] ?? ""}
                            onValueChange={(v) => setMapTarget((m) => ({ ...m, [u.label]: v }))}
                            placeholder={t("aliasOf")}
                            triggerClassName="w-44"
                          />
                          <Button size="sm" disabled={!mapTarget[u.label] || saving} onClick={() => mapAsAlias(u.label)}>
                            {t("mapAlias")}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t("listTitle", { count: colors.length })}</CardTitle>
          {canEdit && (
            <Button size="sm" onClick={() => setDraft({ id: null, name: "", pantoneTcx: "", aliases: [], isActive: true })}>
              <Plus className="mr-2 h-4 w-4" />
              {t("add")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {colors.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>Pantone</TableHead>
                  <TableHead>{t("aliases")}</TableHead>
                  <TableHead>{t("usage")}</TableHead>
                  <TableHead>{t("bomRules")}</TableHead>
                  {canEdit && <TableHead className="w-20" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {colors.map((c) => (
                  <TableRow key={c.id} className={c.isActive ? undefined : "opacity-60"}>
                    <TableCell className="font-medium">
                      {c.name}
                      {!c.isActive && <Badge variant="outline" className="ml-2">{t("inactive")}</Badge>}
                    </TableCell>
                    <TableCell>
                      {c.pantone ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="h-4 w-4 rounded border" style={{ backgroundColor: c.pantone.hex }} aria-hidden />
                          {c.pantone.tcx} · {c.pantone.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{c.aliases.join(", ") || "-"}</TableCell>
                    <TableCell>{t("usageValue", { items: c.itemCount, variants: c.variantCount })}</TableCell>
                    <TableCell>{c.ruleCount}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDraft({ id: c.id, name: c.name, pantoneTcx: c.pantone?.tcx ?? "", aliases: c.aliases, isActive: c.isActive })
                          }
                        >
                          {t("edit")}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={draft != null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? t("editTitle") : t("addTitle")}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="vc-name">{t("name")}</Label>
                <Input id="vc-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vc-tcx">{t("pantoneTcx")}</Label>
                <Input
                  id="vc-tcx"
                  value={draft.pantoneTcx}
                  placeholder="19-0303"
                  onChange={(e) => setDraft({ ...draft, pantoneTcx: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t("pantoneHint")}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("aliases")}</Label>
                <TagsInput value={draft.aliases} onChange={(aliases) => setDraft({ ...draft, aliases })} placeholder={t("aliasPlaceholder")} />
                <p className="text-xs text-muted-foreground">{t("aliasHint")}</p>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="vc-active"
                  checked={draft.isActive}
                  onCheckedChange={(v) => setDraft({ ...draft, isActive: v === true })}
                />
                <Label htmlFor="vc-active">{t("active")}</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={saving || !draft?.name.trim()}
              onClick={async () => {
                if (draft && (await save(draft.id, draft))) setDraft(null);
              }}
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
