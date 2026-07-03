"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { parseCoordsPaste } from "@/lib/geo/coords";
import { createStoreAction, updateStoreAction, deactivateStoreAction } from "./actions";
import type { StoreFields } from "@/lib/stores/queries";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type Props = {
  mode: "create" | "edit";
  storeId?: string;
  readOnly?: boolean;
  hideHeader?: boolean;
  initial: StoreFields & { isActive: boolean };
};

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {title}
    </h3>
  );
}

export function StoreForm({ mode, storeId, readOnly = false, hideHeader = false, initial }: Props) {
  const t = useTranslations("stores.form");
  const tErr = useTranslations("stores.errors");
  const tRoot = useTranslations("stores");
  const tSection = useTranslations("stores.form.sections");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const [form, setForm] = useState<StoreFields>(initial);

  function update<K extends keyof StoreFields>(key: K, value: StoreFields[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function applyPaste() {
    const parsed = parseCoordsPaste(paste);
    if (!parsed) {
      setPasteError(t("pasteCoordsInvalid"));
      return;
    }
    setPasteError(null);
    setForm(prev => ({ ...prev, lat: parsed.lat, lng: parsed.lng }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = mode === "create"
        ? await createStoreAction(form)
        : await updateStoreAction(storeId!, form);
      if (!result.ok) {
        if (result.code === "code_unique") setError(tErr("codeUnique"));
        else if (result.code === "forbidden") setError(tErr("forbidden"));
        else if (result.code === "not_found") setError(tErr("notFound"));
        else setError(result.message);
        return;
      }
      router.push("/backoffice/stores");
      router.refresh();
    });
  }

  async function onDeactivate() {
    if (!storeId) return;
    if (!confirm(t("deactivateConfirm"))) return;
    startTransition(async () => {
      const result = await deactivateStoreAction(storeId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push("/backoffice/stores");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <>
          <h1 className="text-2xl font-bold">{tRoot(mode === "create" ? "new" : "edit")}</h1>
          {readOnly && <p className="text-sm text-muted-foreground">{tRoot("readOnlyBanner")}</p>}
        </>
      )}
      <form onSubmit={submit} className="space-y-6">
        {error && <div className="text-sm text-destructive">{error}</div>}

        <section className="space-y-4">
          <SectionHeader title={tSection("identity")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="code">{t("code")}</Label>
              <Input
                id="code"
                required
                disabled={pending || readOnly}
                value={form.code}
                onChange={e => update("code", e.target.value)}
                placeholder="STR-001"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("name")}</Label>
              <Input
                id="name"
                required
                disabled={pending || readOnly}
                value={form.name}
                onChange={e => update("name", e.target.value)}
              />
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <SectionHeader title={tSection("contact")} />
          <div className="space-y-1.5">
            <Label htmlFor="address">{t("address")}</Label>
            <Textarea
              id="address"
              required
              disabled={pending || readOnly}
              value={form.address}
              onChange={e => update("address", e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="phone">{t("phone")}</Label>
              <Input
                id="phone"
                disabled={pending || readOnly}
                value={form.phone ?? ""}
                onChange={e => update("phone", e.target.value || null)}
                inputMode="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactName">{t("contactName")}</Label>
              <Input
                id="contactName"
                disabled={pending || readOnly}
                value={form.contactName ?? ""}
                onChange={e => update("contactName", e.target.value || null)}
              />
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <SectionHeader title={tSection("terms")} />
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="termsType">{t("termsType")}</Label>
              <Select
                disabled={pending || readOnly}
                value={form.termsType}
                onValueChange={(v) => update("termsType", v as "PUTUS" | "KONSI")}
              >
                <SelectTrigger id="termsType" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUTUS">{t("termsPutus")}</SelectItem>
                  <SelectItem value="KONSI">{t("termsKonsi")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paymentTempo">{t("paymentTempo")}</Label>
              <Input
                id="paymentTempo"
                required
                disabled={pending || readOnly}
                type="number"
                min={0}
                value={form.paymentTempo}
                onChange={e => update("paymentTempo", Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="marginPercent">{t("marginPercent")}</Label>
              <Input
                id="marginPercent"
                disabled={pending || readOnly}
                type="number"
                step="0.01"
                value={form.marginPercent ?? ""}
                onChange={e => update("marginPercent", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <SectionHeader title={tSection("coords")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lat">{t("lat")}</Label>
              <Input
                id="lat"
                disabled={pending || readOnly}
                type="number"
                step="0.0000001"
                value={form.lat ?? ""}
                onChange={e => update("lat", e.target.value === "" ? null : Number(e.target.value))}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lng">{t("lng")}</Label>
              <Input
                id="lng"
                disabled={pending || readOnly}
                type="number"
                step="0.0000001"
                value={form.lng ?? ""}
                onChange={e => update("lng", e.target.value === "" ? null : Number(e.target.value))}
                className="font-mono"
              />
            </div>
          </div>
          <div className="flex gap-2 items-start">
            <Input
              id="pasteCoords"
              disabled={pending || readOnly}
              placeholder={t("pasteCoordsHint")}
              value={paste}
              onChange={e => { setPaste(e.target.value); setPasteError(null); }}
              className="flex-1"
            />
            <Button type="button" variant="outline" onClick={applyPaste} disabled={readOnly}>
              {t("pasteCoords")}
            </Button>
          </div>
          {pasteError && <div className="text-sm text-destructive">{pasteError}</div>}
        </section>

        <Separator />

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {t("save")}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
              {t("cancel")}
            </Button>
            {mode === "edit" && initial.isActive && (
              <Button
                type="button"
                variant="destructive"
                onClick={onDeactivate}
                disabled={pending}
                className="ml-auto"
              >
                {t("deactivate")}
              </Button>
            )}
          </div>
        )}
        {readOnly && (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/backoffice/stores">{t("back")}</Link>
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
