"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { createPromoAction, updatePromoAction, type PromoFormInput } from "@/app/actions/promos";
import type { PromoDetail } from "@/lib/promos/queries";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ItemOption = { id: string; sku: string; nameId: string; isActive: boolean };
export type StoreOption = { id: string; name: string; isActive: boolean };

type TierRow = { minQty: number | null; unitPrice: number | null };

type FormState = {
  name: string;
  type: "PERCENT" | "FIXED" | "TIERED";
  level: "LINE" | "ORDER";
  value: number | null;
  minQty: number | null;
  minOrderSubtotal: number | null;
  minOrderQty: number | null;
  allStores: boolean;
  startsAt: string;
  endsAt: string;
  priority: number;
  isActive: boolean;
  itemIds: string[];
  storeIds: string[];
  tiers: TierRow[];
};

type Props = {
  mode: "create" | "edit";
  canManage: boolean;
  itemOptions: ItemOption[];
  storeOptions: StoreOption[];
  defaults: PromoDetail | null;
};

function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function buildInitialState(defaults: PromoDetail | null): FormState {
  if (!defaults) {
    return {
      name: "",
      type: "PERCENT",
      level: "LINE",
      value: null,
      minQty: null,
      minOrderSubtotal: null,
      minOrderQty: null,
      allStores: true,
      startsAt: "",
      endsAt: "",
      priority: 0,
      isActive: true,
      itemIds: [],
      storeIds: [],
      tiers: [],
    };
  }
  return {
    name: defaults.name,
    type: defaults.type as FormState["type"],
    level: defaults.level as FormState["level"],
    value: defaults.value,
    minQty: defaults.minQty,
    minOrderSubtotal: defaults.minOrderSubtotal,
    minOrderQty: defaults.minOrderQty,
    allStores: defaults.allStores,
    startsAt: toDateInputValue(defaults.startsAt),
    endsAt: toDateInputValue(defaults.endsAt),
    priority: defaults.priority,
    isActive: defaults.isActive,
    itemIds: defaults.itemIds,
    storeIds: defaults.storeIds,
    tiers: defaults.tiers.map((t) => ({ minQty: t.minQty, unitPrice: t.unitPrice })),
  };
}

function numberOrNull(raw: string): number | null {
  return raw === "" ? null : Number(raw);
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {title}
    </h3>
  );
}

export function PromoForm({ mode, canManage, itemOptions, storeOptions, defaults }: Props) {
  const t = useTranslations("promos");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => buildInitialState(defaults));
  const [itemSearch, setItemSearch] = useState("");
  const [storeSearch, setStoreSearch] = useState("");

  const readOnly = !canManage;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onTypeChange(next: FormState["type"]) {
    setForm((prev) => ({
      ...prev,
      type: next,
      level: next === "TIERED" ? "LINE" : prev.level,
      tiers: next === "TIERED" && prev.tiers.length === 0 ? [{ minQty: null, unitPrice: null }] : prev.tiers,
    }));
  }

  function addTier() {
    setForm((prev) => ({ ...prev, tiers: [...prev.tiers, { minQty: null, unitPrice: null }] }));
  }

  function removeTier(idx: number) {
    setForm((prev) => ({ ...prev, tiers: prev.tiers.filter((_, i) => i !== idx) }));
  }

  function updateTier(idx: number, key: keyof TierRow, value: number | null) {
    setForm((prev) => ({
      ...prev,
      tiers: prev.tiers.map((row, i) => (i === idx ? { ...row, [key]: value } : row)),
    }));
  }

  function toggleItem(id: string) {
    setForm((prev) => ({
      ...prev,
      itemIds: prev.itemIds.includes(id)
        ? prev.itemIds.filter((x) => x !== id)
        : [...prev.itemIds, id],
    }));
  }

  function toggleStore(id: string) {
    setForm((prev) => ({
      ...prev,
      storeIds: prev.storeIds.includes(id)
        ? prev.storeIds.filter((x) => x !== id)
        : [...prev.storeIds, id],
    }));
  }

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return itemOptions;
    return itemOptions.filter(
      (it) => it.sku.toLowerCase().includes(q) || it.nameId.toLowerCase().includes(q)
    );
  }, [itemOptions, itemSearch]);

  const filteredStores = useMemo(() => {
    const q = storeSearch.trim().toLowerCase();
    if (!q) return storeOptions;
    return storeOptions.filter((s) => s.name.toLowerCase().includes(q));
  }, [storeOptions, storeSearch]);

  function clientValidationError(): string | null {
    if (!form.name.trim()) return t("errInvalid");
    if (form.type === "TIERED") {
      if (form.tiers.length === 0) return t("errInvalid");
      if (form.tiers.some((row) => row.minQty === null || row.unitPrice === null)) return t("errInvalid");
    } else if (form.value === null) {
      return t("errInvalid");
    }
    if (form.level === "LINE" && form.itemIds.length === 0) return t("errInvalid");
    if (!form.allStores && form.storeIds.length === 0) return t("errInvalid");
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || pending) return;

    const clientError = clientValidationError();
    if (clientError) {
      toast.error(clientError);
      return;
    }

    const payload: PromoFormInput = {
      id: mode === "edit" ? defaults?.id : undefined,
      name: form.name.trim(),
      type: form.type,
      level: form.level,
      value: form.type === "TIERED" ? null : form.value,
      minQty: form.level === "LINE" ? form.minQty : null,
      minOrderSubtotal: form.level === "ORDER" ? form.minOrderSubtotal : null,
      minOrderQty: form.level === "ORDER" ? form.minOrderQty : null,
      allStores: form.allStores,
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null,
      priority: form.priority,
      isActive: form.isActive,
      itemIds: form.level === "LINE" ? form.itemIds : [],
      storeIds: form.allStores ? [] : form.storeIds,
      tiers:
        form.type === "TIERED"
          ? form.tiers
              .filter((row) => row.minQty !== null && row.unitPrice !== null)
              .map((row) => ({ minQty: row.minQty as number, unitPrice: row.unitPrice as number }))
          : [],
    };

    startTransition(async () => {
      try {
        const result = mode === "create" ? await createPromoAction(payload) : await updatePromoAction(payload);
        if (result.ok) {
          toast.success(t("saved"));
          router.push("/backoffice/promos");
          return;
        }
        if (result.reason === "FORBIDDEN") {
          toast.error(t("errForbidden"));
        } else {
          toast.error(t("errInvalid"));
        }
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  const fieldsDisabled = readOnly || pending;

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>{mode === "create" ? t("new") : t("edit")}</CardTitle>
            {readOnly && <CardDescription>{t("readOnlyBanner")}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Basic info */}
            <section className="space-y-4">
              <SectionHeader title={t("sectionBasic")} />
              <div className="space-y-1.5">
                <Label htmlFor="name">{t("name")}</Label>
                <Input
                  id="name"
                  required
                  disabled={fieldsDisabled}
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="type">{t("type")}</Label>
                  <Select
                    disabled={fieldsDisabled}
                    value={form.type}
                    onValueChange={(v) => onTypeChange(v as FormState["type"])}
                  >
                    <SelectTrigger id="type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PERCENT">{t("typePercent")}</SelectItem>
                      <SelectItem value="FIXED">{t("typeFixed")}</SelectItem>
                      <SelectItem value="TIERED">{t("typeTiered")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="level">{t("level")}</Label>
                  <Select
                    disabled={fieldsDisabled || form.type === "TIERED"}
                    value={form.level}
                    onValueChange={(v) => update("level", v as FormState["level"])}
                  >
                    <SelectTrigger id="level" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LINE">{t("levelLine")}</SelectItem>
                      <SelectItem value="ORDER">{t("levelOrder")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {form.type !== "TIERED" && (
                <div className="space-y-1.5 sm:w-1/2">
                  <Label htmlFor="value">{t("value")}</Label>
                  <Input
                    id="value"
                    type="number"
                    min={0}
                    max={form.type === "PERCENT" ? 100 : undefined}
                    required
                    disabled={fieldsDisabled}
                    value={form.value ?? ""}
                    onChange={(e) => update("value", numberOrNull(e.target.value))}
                  />
                </div>
              )}

              {form.type === "TIERED" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>{t("tiers")}</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={fieldsDisabled}
                      onClick={addTier}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      {t("addTier")}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {form.tiers.length === 0 && (
                      <p className="text-sm text-muted-foreground">{tCommon("noData")}</p>
                    )}
                    {form.tiers.map((row, idx) => (
                      <div key={idx} className="flex items-end gap-2">
                        <div className="flex-1 space-y-1.5">
                          <Label htmlFor={`tier-minqty-${idx}`} className="text-xs">
                            {t("tierMinQty")}
                          </Label>
                          <Input
                            id={`tier-minqty-${idx}`}
                            type="number"
                            min={1}
                            required
                            disabled={fieldsDisabled}
                            value={row.minQty ?? ""}
                            onChange={(e) => updateTier(idx, "minQty", numberOrNull(e.target.value))}
                          />
                        </div>
                        <div className="flex-1 space-y-1.5">
                          <Label htmlFor={`tier-price-${idx}`} className="text-xs">
                            {t("tierUnitPrice")}
                          </Label>
                          <Input
                            id={`tier-price-${idx}`}
                            type="number"
                            min={0}
                            required
                            disabled={fieldsDisabled}
                            value={row.unitPrice ?? ""}
                            onChange={(e) => updateTier(idx, "unitPrice", numberOrNull(e.target.value))}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={fieldsDisabled}
                          onClick={() => removeTier(idx)}
                          aria-label={tCommon("delete")}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <Separator />

            {/* Conditions */}
            <section className="space-y-4">
              <SectionHeader title={t("sectionConditions")} />
              {form.level === "LINE" && (
                <div className="space-y-1.5 sm:w-1/2">
                  <Label htmlFor="minQty">{t("minQty")}</Label>
                  <Input
                    id="minQty"
                    type="number"
                    min={0}
                    disabled={fieldsDisabled}
                    value={form.minQty ?? ""}
                    onChange={(e) => update("minQty", numberOrNull(e.target.value))}
                  />
                </div>
              )}
              {form.level === "ORDER" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="minOrderSubtotal">{t("minOrderSubtotal")}</Label>
                    <Input
                      id="minOrderSubtotal"
                      type="number"
                      min={0}
                      disabled={fieldsDisabled}
                      value={form.minOrderSubtotal ?? ""}
                      onChange={(e) => update("minOrderSubtotal", numberOrNull(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="minOrderQty">{t("minOrderQty")}</Label>
                    <Input
                      id="minOrderQty"
                      type="number"
                      min={0}
                      disabled={fieldsDisabled}
                      value={form.minOrderQty ?? ""}
                      onChange={(e) => update("minOrderQty", numberOrNull(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </section>

            <Separator />

            {/* Scope */}
            <section className="space-y-4">
              <SectionHeader title={t("sectionScope")} />

              {form.level === "LINE" && (
                <div className="space-y-1.5">
                  <Label>{t("items")}</Label>
                  <Input
                    placeholder={tCommon("search")}
                    disabled={fieldsDisabled}
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                  />
                  <ScrollArea className="h-48 rounded-md border p-2">
                    {filteredItems.length === 0 ? (
                      <p className="p-2 text-sm text-muted-foreground">{tCommon("noData")}</p>
                    ) : (
                      <div className="space-y-1">
                        {filteredItems.map((it) => (
                          <label
                            key={it.id}
                            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                          >
                            <Checkbox
                              checked={form.itemIds.includes(it.id)}
                              disabled={fieldsDisabled}
                              onCheckedChange={() => toggleItem(it.id)}
                            />
                            <span className="font-mono text-xs text-muted-foreground">{it.sku}</span>
                            <span className="truncate">{it.nameId}</span>
                            {!it.isActive && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                ({tCommon("inactive")})
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              )}

              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="allStores" className="cursor-pointer">
                  {t("allStores")}
                </Label>
                <Switch
                  id="allStores"
                  disabled={fieldsDisabled}
                  checked={form.allStores}
                  onCheckedChange={(checked) => update("allStores", checked)}
                />
              </div>

              {!form.allStores && (
                <div className="space-y-1.5">
                  <Label>{t("stores")}</Label>
                  <Input
                    placeholder={tCommon("search")}
                    disabled={fieldsDisabled}
                    value={storeSearch}
                    onChange={(e) => setStoreSearch(e.target.value)}
                  />
                  <ScrollArea className="h-48 rounded-md border p-2">
                    {filteredStores.length === 0 ? (
                      <p className="p-2 text-sm text-muted-foreground">{tCommon("noData")}</p>
                    ) : (
                      <div className="space-y-1">
                        {filteredStores.map((s) => (
                          <label
                            key={s.id}
                            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                          >
                            <Checkbox
                              checked={form.storeIds.includes(s.id)}
                              disabled={fieldsDisabled}
                              onCheckedChange={() => toggleStore(s.id)}
                            />
                            <span className="truncate">{s.name}</span>
                            {!s.isActive && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                ({tCommon("inactive")})
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              )}
            </section>

            <Separator />

            {/* Schedule */}
            <section className="space-y-4">
              <SectionHeader title={t("sectionSchedule")} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="startsAt">{t("startsAt")}</Label>
                  <Input
                    id="startsAt"
                    type="date"
                    disabled={fieldsDisabled}
                    value={form.startsAt}
                    onChange={(e) => update("startsAt", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endsAt">{t("endsAt")}</Label>
                  <Input
                    id="endsAt"
                    type="date"
                    disabled={fieldsDisabled}
                    value={form.endsAt}
                    onChange={(e) => update("endsAt", e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="priority">{t("priority")}</Label>
                  <Input
                    id="priority"
                    type="number"
                    disabled={fieldsDisabled}
                    value={form.priority}
                    onChange={(e) => update("priority", Number(e.target.value) || 0)}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label htmlFor="isActive" className="cursor-pointer">
                    {t("isActive")}
                  </Label>
                  <Switch
                    id="isActive"
                    disabled={fieldsDisabled}
                    checked={form.isActive}
                    onCheckedChange={(checked) => update("isActive", checked)}
                  />
                </div>
              </div>
            </section>

            <Separator />

            <div className="flex flex-wrap items-center gap-2">
              {!readOnly && (
                <Button type="submit" disabled={fieldsDisabled}>
                  {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("save")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => router.push("/backoffice/promos")}
              >
                {readOnly ? tCommon("back") : tCommon("cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
