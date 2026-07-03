"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { StoreListItem } from "@/lib/stores/queries";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <div className="flex items-center gap-4">
        <Input placeholder={tList("searchPlaceholder")} value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64" />
        <div className="flex items-center gap-2">
          <Checkbox id="show-inactive" checked={showInactive} onCheckedChange={(checked) => setShowInactive(checked === true)} />
          <Label htmlFor="show-inactive" className="text-sm font-normal">{tList("showInactive")}</Label>
        </div>
        <Button asChild className="ml-auto">
          <Link href="/backoffice/stores/new">{t("new")}</Link>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">{tList("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tTable("code")}</TableHead>
              <TableHead>{tTable("name")}</TableHead>
              <TableHead>{tTable("terms")}</TableHead>
              <TableHead>{tTable("tempo")}</TableHead>
              <TableHead>{tTable("margin")}</TableHead>
              <TableHead>{tTable("address")}</TableHead>
              <TableHead>{tTable("status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(s => (
              <TableRow key={s.id}>
                <TableCell><Link href={`/backoffice/stores/${s.id}`} className="underline">{s.code}</Link></TableCell>
                <TableCell>{s.name}</TableCell>
                <TableCell>
                  <Badge variant={s.termsType === "PUTUS" ? "outline" : "secondary"}>
                    {s.termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}
                  </Badge>
                </TableCell>
                <TableCell>{s.paymentTempo}d</TableCell>
                <TableCell>{s.marginPercent ?? "—"}</TableCell>
                <TableCell className="truncate max-w-[220px]" title={s.address}>{s.address}</TableCell>
                <TableCell>
                  <Badge variant={s.isActive ? "default" : "outline"}>
                    {s.isActive ? tTable("active") : tBadge("inactive")}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
