"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { parseCoordsPaste } from "@/lib/geo/coords";
import { createStoreAction, updateStoreAction, deactivateStoreAction } from "./actions";
import type { StoreFields } from "@/lib/stores/queries";

type Props = {
  mode: "create" | "edit";
  storeId?: string;
  initial: StoreFields & { isActive: boolean };
};

export function StoreForm({ mode, storeId, initial }: Props) {
  const t = useTranslations("stores.form");
  const tErr = useTranslations("stores.errors");
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
        setError(result.code === "code_unique" ? tErr("codeUnique") : result.message);
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
    <form onSubmit={submit} className="space-y-4 max-w-2xl">
      {error && <div className="text-sm text-destructive">{error}</div>}

      <label className="block">
        <span className="text-sm font-medium">{t("code")}</span>
        <input required value={form.code} onChange={e => update("code", e.target.value)}
          className="w-full mt-1 border rounded px-2 py-1" />
      </label>

      <label className="block">
        <span className="text-sm font-medium">{t("name")}</span>
        <input required value={form.name} onChange={e => update("name", e.target.value)}
          className="w-full mt-1 border rounded px-2 py-1" />
      </label>

      <label className="block">
        <span className="text-sm font-medium">{t("address")}</span>
        <textarea required value={form.address} onChange={e => update("address", e.target.value)}
          rows={3} className="w-full mt-1 border rounded px-2 py-1" />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium">{t("phone")}</span>
          <input value={form.phone ?? ""} onChange={e => update("phone", e.target.value || null)}
            className="w-full mt-1 border rounded px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t("contactName")}</span>
          <input value={form.contactName ?? ""} onChange={e => update("contactName", e.target.value || null)}
            className="w-full mt-1 border rounded px-2 py-1" />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <label className="block">
          <span className="text-sm font-medium">{t("termsType")}</span>
          <select required value={form.termsType} onChange={e => update("termsType", e.target.value as "PUTUS" | "KONSI")}
            className="w-full mt-1 border rounded px-2 py-1">
            <option value="PUTUS">{t("termsPutus")}</option>
            <option value="KONSI">{t("termsKonsi")}</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t("paymentTempo")}</span>
          <input required type="number" min={0} value={form.paymentTempo}
            onChange={e => update("paymentTempo", Number(e.target.value))}
            className="w-full mt-1 border rounded px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t("marginPercent")}</span>
          <input type="number" step="0.01" value={form.marginPercent ?? ""}
            onChange={e => update("marginPercent", e.target.value === "" ? null : Number(e.target.value))}
            className="w-full mt-1 border rounded px-2 py-1" />
        </label>
      </div>

      <fieldset className="border rounded p-3">
        <legend className="text-sm font-medium px-1">{t("coords")}</legend>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm">{t("lat")}</span>
            <input type="number" step="0.0000001" value={form.lat ?? ""}
              onChange={e => update("lat", e.target.value === "" ? null : Number(e.target.value))}
              className="w-full mt-1 border rounded px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-sm">{t("lng")}</span>
            <input type="number" step="0.0000001" value={form.lng ?? ""}
              onChange={e => update("lng", e.target.value === "" ? null : Number(e.target.value))}
              className="w-full mt-1 border rounded px-2 py-1" />
          </label>
        </div>
        <div className="mt-2 flex gap-2 items-start">
          <input placeholder={t("pasteCoordsHint")} value={paste}
            onChange={e => { setPaste(e.target.value); setPasteError(null); }}
            className="flex-1 border rounded px-2 py-1" />
          <button type="button" onClick={applyPaste} className="border rounded px-3 py-1">
            {t("pasteCoords")}
          </button>
        </div>
        {pasteError && <div className="text-sm text-destructive mt-1">{pasteError}</div>}
      </fieldset>

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="bg-primary text-primary-foreground rounded px-4 py-2">
          {t("save")}
        </button>
        <button type="button" onClick={() => router.back()} className="border rounded px-4 py-2">
          {t("cancel")}
        </button>
        {mode === "edit" && initial.isActive && (
          <button type="button" onClick={onDeactivate} disabled={pending}
            className="ml-auto text-destructive border border-destructive rounded px-4 py-2">
            {t("deactivate")}
          </button>
        )}
      </div>
    </form>
  );
}
