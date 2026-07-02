"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { StoreListItem } from "@/lib/stores/queries";

export function StoreListClient({ stores }: { stores: StoreListItem[] }) {
  const t = useTranslations("stores");
  const tList = useTranslations("stores.list");
  const tTable = useTranslations("stores.list.table");
  const tBadge = useTranslations("stores.badge");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const filtered = stores.filter(s => {
    if (!showInactive && !s.isActive) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <input placeholder={tList("searchPlaceholder")} value={search}
          onChange={e => setSearch(e.target.value)}
          className="border rounded px-2 py-1 w-64" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          {tList("showInactive")}
        </label>
        <Link href="/backoffice/stores/new" className="ml-auto bg-primary text-primary-foreground rounded px-3 py-1">
          {t("new")}
        </Link>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">{tList("empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">{tTable("code")}</th>
              <th>{tTable("name")}</th>
              <th>{tTable("terms")}</th>
              <th>{tTable("tempo")}</th>
              <th>{tTable("margin")}</th>
              <th>{tTable("address")}</th>
              <th>{tTable("status")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} className="border-b hover:bg-muted/50">
                <td className="py-2"><Link href={`/backoffice/stores/${s.id}`} className="underline">{s.code}</Link></td>
                <td>{s.name}</td>
                <td>{s.termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}</td>
                <td>{s.paymentTempo}d</td>
                <td>{s.marginPercent ?? "—"}</td>
                <td className="truncate max-w-[220px]" title={s.address}>{s.address}</td>
                <td>{s.isActive ? tTable("active") : tBadge("inactive")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
