"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { getItems } from "@/app/actions/items";
import { itemHasSkuVariants, parseItemVariants, variantSelectOptions } from "@/lib/items/variants";
import {
  addAssortmentLineAction,
  removeAssortmentLineAction,
  updateAssortmentTargetAction,
  type StoreAssortmentActionResult,
} from "@/app/actions/store-assortment";
import type { AssortmentLineRow } from "@/lib/stores/assortment/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/ui/searchable-combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AssortmentLineViewModel = Omit<AssortmentLineRow, "createdAt"> & { createdAtIso: string };

type Props = {
  storeId: string;
  termsType: "PUTUS" | "KONSI";
  lines: AssortmentLineViewModel[];
};

type CatalogMeta = { itemId: string; itemSku: string; variantSku: string; productName: string };

type CatalogState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; options: SearchableComboboxOption[]; metaByKey: Map<string, CatalogMeta> }
  | { status: "error" };

type AssortmentErrCode = Extract<StoreAssortmentActionResult, { ok: false }>["code"];

/**
 * Exhaustive over `StoreAssortmentActionResult`'s own declared error union — if that union ever
 * widens, this `Record` stops compiling here instead of a raw code string reaching the screen.
 */
const ASSORTMENT_ERR_KEY: Record<AssortmentErrCode, string> = {
  FORBIDDEN: "err.FORBIDDEN",
  ITEM_NOT_FOUND: "err.ITEM_NOT_FOUND",
  DUPLICATE_LINE: "err.DUPLICATE_LINE",
  INVALID_REQUEST: "err.INVALID_REQUEST",
  NOT_FOUND: "err.NOT_FOUND",
  ERROR: "err.ERROR",
};

/**
 * Mirrors the action's own rule: blank means `null` ("must be present"), a positive number is a
 * minimum, zero and negative are refused. Validated here too so the operator sees why before a
 * round trip, not only after a failed submit. `Number("")` is `0`, so the blank case is checked
 * first and short-circuits before any coercion happens.
 */
function parseTargetInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}

function targetRawForDisplay(targetQty: number | null): string {
  return targetQty === null ? "" : String(targetQty);
}

export function StoreAssortmentCard({ storeId, termsType, lines }: Props) {
  const t = useTranslations("stores.assortment");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [addOpen, setAddOpen] = useState(false);
  const [addItemKey, setAddItemKey] = useState("");
  const [addTargetRaw, setAddTargetRaw] = useState("");
  const [catalog, setCatalog] = useState<CatalogState>({ status: "idle" });
  const [adding, startAddTransition] = useTransition();
  const addInFlight = useRef(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTargetRaw, setEditTargetRaw] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [, startSaveTransition] = useTransition();
  const saveInFlight = useRef(false);

  const [removeTarget, setRemoveTarget] = useState<AssortmentLineViewModel | null>(null);
  const [removing, startRemoveTransition] = useTransition();
  const removeInFlight = useRef(false);

  const existingKeys = new Set(lines.map((l) => `${l.itemId}::${l.variantSku}`));
  const addTarget = parseTargetInput(addTargetRaw);
  const canSubmitAdd = catalog.status === "loaded" && addItemKey !== "" && addTarget.ok && !adding;

  function openAddDialog(): void {
    setAddOpen(true);
    setAddItemKey("");
    setAddTargetRaw("");
    setCatalog({ status: "loading" });
    startAddTransition(async () => {
      try {
        const items = await getItems({ isActive: true, type: "FINISHED_GOOD" });
        const list = Array.isArray(items) ? items : [];
        const options: SearchableComboboxOption[] = [];
        const metaByKey = new Map<string, CatalogMeta>();
        for (const item of list as unknown as Array<{ id: string; sku: string; nameId: string; variants: unknown }>) {
          const variantRows = parseItemVariants(item.variants);
          if (itemHasSkuVariants(item.variants)) {
            for (const variant of variantSelectOptions(variantRows)) {
              const key = `${item.id}::${variant.sku}`;
              if (existingKeys.has(key)) continue;
              options.push({ value: key, label: `${item.sku} — ${item.nameId} · ${variant.label}` });
              metaByKey.set(key, { itemId: item.id, itemSku: item.sku, variantSku: variant.sku, productName: item.nameId });
            }
          } else {
            const key = `${item.id}::`;
            if (existingKeys.has(key)) continue;
            options.push({ value: key, label: `${item.sku} — ${item.nameId}` });
            metaByKey.set(key, { itemId: item.id, itemSku: item.sku, variantSku: "", productName: item.nameId });
          }
        }
        setCatalog({ status: "loaded", options, metaByKey });
      } catch {
        setCatalog({ status: "error" });
      }
    });
  }

  function closeAddDialog(open: boolean): void {
    if (adding) return;
    setAddOpen(open);
  }

  function submitAdd(): void {
    if (addInFlight.current || catalog.status !== "loaded" || !addTarget.ok) return;
    const meta = catalog.metaByKey.get(addItemKey);
    if (!meta) return;
    addInFlight.current = true;
    startAddTransition(async () => {
      try {
        const result = await addAssortmentLineAction({
          storeId,
          itemId: meta.itemId,
          variantSku: meta.variantSku,
          targetQty: addTarget.value,
        });
        if (result.ok) {
          toast.success(t("addSuccess"));
          setAddOpen(false);
          router.refresh();
          return;
        }
        toast.error(t(ASSORTMENT_ERR_KEY[result.code]));
      } catch {
        toast.error(t(ASSORTMENT_ERR_KEY.ERROR));
      } finally {
        addInFlight.current = false;
      }
    });
  }

  function startEditTarget(line: AssortmentLineViewModel): void {
    if (savingId !== null) return;
    setEditingId(line.id);
    setEditTargetRaw(targetRawForDisplay(line.targetQty));
  }

  function cancelEditTarget(): void {
    if (savingId !== null) return;
    setEditingId(null);
    setEditTargetRaw("");
  }

  function submitEditTarget(line: AssortmentLineViewModel): void {
    const parsed = parseTargetInput(editTargetRaw);
    if (saveInFlight.current || !parsed.ok) return;
    saveInFlight.current = true;
    setSavingId(line.id);
    startSaveTransition(async () => {
      try {
        const result = await updateAssortmentTargetAction({ id: line.id, storeId, targetQty: parsed.value });
        if (result.ok) {
          toast.success(t("updateSuccess"));
          setEditingId(null);
          setEditTargetRaw("");
          router.refresh();
          return;
        }
        toast.error(t(ASSORTMENT_ERR_KEY[result.code]));
      } catch {
        toast.error(t(ASSORTMENT_ERR_KEY.ERROR));
      } finally {
        saveInFlight.current = false;
        setSavingId(null);
      }
    });
  }

  function closeRemoveDialog(open: boolean): void {
    if (removing) return;
    if (!open) setRemoveTarget(null);
  }

  function submitRemove(): void {
    if (removeInFlight.current || !removeTarget) return;
    removeInFlight.current = true;
    const line = removeTarget;
    startRemoveTransition(async () => {
      try {
        const result = await removeAssortmentLineAction({ id: line.id, storeId });
        if (result.ok) {
          toast.success(t("removeSuccess"));
          setRemoveTarget(null);
          router.refresh();
          return;
        }
        toast.error(t(ASSORTMENT_ERR_KEY[result.code]));
      } catch {
        toast.error(t(ASSORTMENT_ERR_KEY.ERROR));
      } finally {
        removeInFlight.current = false;
      }
    });
  }

  /**
   * A PUTUS store has no `StoreStock` ledger, so nothing here would ever surface — the gap
   * section lives inside the KONSI-only stock card, and the other two consumers (order approval,
   * stocktake) are consignment-only documents too. Explain why rather than rendering nothing, so
   * an admin who goes looking learns the reason instead of concluding the feature is missing.
   */
  if (termsType !== "KONSI") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" />
            {t("cardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("putusNotice")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" />
            {t("cardTitle")}
            <span className="text-sm font-normal text-muted-foreground ml-2">({lines.length})</span>
          </CardTitle>
          <Button size="sm" onClick={openAddDialog}>
            <Plus className="h-4 w-4" />
            {t("addButton")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          {lines.length === 0 ? (
            <div className="text-center py-8">
              <ListChecks className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colProduct")}</TableHead>
                    <TableHead>{t("colVariant")}</TableHead>
                    <TableHead>{t("colTarget")}</TableHead>
                    <TableHead className="w-16 text-right">{t("colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const isEditing = editingId === line.id;
                    const isSavingThis = savingId === line.id;
                    const editParsed = parseTargetInput(editTargetRaw);
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="text-sm">
                          <span className="font-mono text-xs text-muted-foreground">{line.itemSku}</span>
                          <span className="ml-1.5">{line.productName}</span>
                        </TableCell>
                        <TableCell className="text-xs">
                          {line.variantSku ? (
                            <>
                              <span className="font-mono">{line.variantSku}</span>
                              {line.variantLabel && <span className="text-muted-foreground"> · {line.variantLabel}</span>}
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <Input
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                disabled={isSavingThis}
                                placeholder={t("targetPlaceholder")}
                                aria-label={`${t("colTarget")} — ${line.productName}`}
                                className="w-24 tabular-nums"
                                value={editTargetRaw}
                                onChange={(e) => setEditTargetRaw(e.target.value)}
                              />
                              <Button size="sm" disabled={isSavingThis || !editParsed.ok} onClick={() => submitEditTarget(line)}>
                                {isSavingThis ? t("savingTarget") : t("saveTarget")}
                              </Button>
                              <Button size="sm" variant="ghost" disabled={isSavingThis} onClick={cancelEditTarget}>
                                {t("cancelEdit")}
                              </Button>
                              {!editParsed.ok && <p className="text-xs text-destructive">{t("targetInvalid")}</p>}
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-auto gap-1.5 px-1.5 py-1 font-normal"
                              disabled={savingId !== null}
                              onClick={() => startEditTarget(line)}
                            >
                              {line.targetQty === null ? (
                                <Badge variant="outline">{t("targetMustBePresent")}</Badge>
                              ) : (
                                <span className="tabular-nums">{t("targetMin", { qty: line.targetQty })}</span>
                              )}
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={removing && removeTarget?.id === line.id}
                            aria-label={`${t("remove")} — ${line.productName}`}
                            onClick={() => setRemoveTarget(line)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={closeAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogDescription")}</DialogDescription>
          </DialogHeader>

          {catalog.status === "loading" && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
          {catalog.status === "error" && <p className="text-sm text-destructive">{t("loadError")}</p>}
          {catalog.status === "loaded" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="assortment-item">{t("itemLabel")}</Label>
                <SearchableCombobox
                  id="assortment-item"
                  options={catalog.options}
                  value={addItemKey}
                  onValueChange={setAddItemKey}
                  disabled={adding}
                  placeholder={t("searchPlaceholder")}
                  searchPlaceholder={t("searchPlaceholder")}
                  emptyMessage={t("emptyMessage")}
                  triggerClassName="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assortment-target">{t("targetLabel")}</Label>
                <Input
                  id="assortment-target"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  disabled={adding}
                  placeholder={t("targetPlaceholder")}
                  value={addTargetRaw}
                  onChange={(e) => setAddTargetRaw(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("targetHint")}</p>
                {!addTarget.ok && addTargetRaw !== "" && <p className="text-xs text-destructive">{t("targetInvalid")}</p>}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" disabled={adding} onClick={() => closeAddDialog(false)}>
              {tCommon("cancel")}
            </Button>
            <Button disabled={!canSubmitAdd} onClick={submitAdd}>
              {adding ? t("adding") : t("add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeTarget} onOpenChange={closeRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("removeConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; it closes on success. */
                e.preventDefault();
                submitRemove();
              }}
            >
              {removing ? t("removing") : t("removeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
