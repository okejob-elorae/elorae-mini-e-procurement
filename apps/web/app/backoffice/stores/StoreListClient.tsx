"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, Inbox, Layers, MapPinned, Plus, Search, Store } from "lucide-react";
import type { StoreListItem } from "@/lib/stores/queries";
import type { AreaToko } from "@/lib/stores/areas";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KelolaAreaDialog } from "./KelolaAreaDialog";
import { PindahTokoDialog } from "./PindahTokoDialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pager } from "@/components/Pager";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";

type Props = {
  stores: StoreListItem[];
  totalCount: number;
  search: string;
  showInactive: boolean;
  page: number;
  pageSize: number;
  pendingStoreIds: string[];
  areas: AreaToko[];
  salesmen: { id: string; nama: string }[];
  /** id pemegang → nama, termasuk pemegang yang perannya sudah bukan sales. */
  namaPemegang: Record<string, string>;
  areaFilter: string;
  /** id sales, "TANPA" (belum punya pemegang), atau "" (semua). */
  salesFilter: string;
  bolehKelola: boolean;
  /** Saringan kelas toko: "A" | "B" | "C" | "TANPA" | "" (semua). Opsional agar pemanggil lama tetap jalan. */
  kelasFilter?: string;
  /** Usulan toko baru dari lapangan yang menunggu diputuskan. Opsional agar pemanggil lama tetap jalan. */
  usulanMenunggu?: number;
  /** `?perubahan=menunggu` — hanya toko yang perubahan datanya menunggu ditinjau. */
  perubahanMenunggu?: boolean;
  /** Jumlah toko yang perubahan datanya menunggu (semua toko, aktif maupun nonaktif). */
  jumlahPerubahan?: number;
};

// Radix Select tidak menerima nilai kosong.
const SEMUA = "__SEMUA__";

export function StoreListClient({
  stores,
  totalCount,
  search,
  showInactive,
  page,
  pageSize,
  pendingStoreIds,
  areas,
  salesmen,
  namaPemegang,
  areaFilter,
  salesFilter,
  bolehKelola,
  kelasFilter = "",
  usulanMenunggu = 0,
  perubahanMenunggu = false,
  jumlahPerubahan = 0,
}: Props) {
  const t = useTranslations("stores");
  const tList = useTranslations("stores.list");
  const tTable = useTranslations("stores.list.table");
  const tBadge = useTranslations("stores.badge");
  const tChange = useTranslations("stores.storeChanges");
  const tUsulan = useTranslations("storeProposals");
  const tKelas = useTranslations("kelasToko.daftar");
  const pendingSet = new Set(pendingStoreIds);
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(search);
  const [bukaArea, setBukaArea] = useState(false);
  const [bukaPindah, setBukaPindah] = useState(false);
  const kodeArea = new Map(areas.map((a) => [a.id, a.code]));

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== search) pushParam("search", searchInput);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    startTransition(() => router.push(`/backoffice/stores?${params.toString()}`));
  }

  function toggleShowInactive(next: boolean) {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("showInactive", "1");
    else params.delete("showInactive");
    params.delete("page");
    startTransition(() => router.push(`/backoffice/stores?${params.toString()}`));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <TombolBantuan judul={t("title")} />
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Calon toko dari lapangan menunggu di sini; lencananya menghitung yang belum diputuskan. */}
          <Button variant="outline" asChild>
            <Link href="/backoffice/stores/usulan">
              <Inbox className="h-4 w-4" />
              {tUsulan("headerLink")}
              {usulanMenunggu > 0 ? (
                <Badge variant="secondary" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                  {tUsulan("pendingBadge", { count: usulanMenunggu })}
                </Badge>
              ) : null}
            </Link>
          </Button>
          {bolehKelola ? (
            <>
              <Button variant="outline" onClick={() => setBukaArea(true)}>
                <MapPinned className="h-4 w-4" />
                {tList("manageAreas")}
              </Button>
              <Button variant="outline" onClick={() => setBukaPindah(true)}>
                <ArrowLeftRight className="h-4 w-4" />
                {tList("moveStores")}
              </Button>
            </>
          ) : null}
          <Button asChild variant="outline">
            <Link href="/backoffice/stores/kelas">
              <Layers className="h-4 w-4" />
              {tKelas("tombol")}
            </Link>
          </Button>
          <Button asChild>
            <Link href="/backoffice/stores/new">
              <Plus className="mr-2 h-4 w-4" />
              {t("new")}
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 sm:items-center">
        <div className="relative flex-1 min-w-[16rem] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tList("searchPlaceholder")}
            aria-label={tList("searchPlaceholder")}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={areaFilter || SEMUA} onValueChange={(v) => pushParam("area", v === SEMUA ? undefined : v)}>
          <SelectTrigger className="w-full sm:w-44" aria-label={tList("filterArea")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{tList("allAreas")}</SelectItem>
            {areas.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.code} — {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={salesFilter || SEMUA} onValueChange={(v) => pushParam("sales", v === SEMUA ? undefined : v)}>
          <SelectTrigger className="w-full sm:w-52" aria-label={tList("filterSales")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{tList("allSales")}</SelectItem>
            <SelectItem value="TANPA">{tList("noSales")}</SelectItem>
            {salesmen.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kelasFilter || SEMUA} onValueChange={(v) => pushParam("kelas", v === SEMUA ? undefined : v)}>
          <SelectTrigger className="w-full sm:w-40" aria-label={tKelas("saring")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{tKelas("semua")}</SelectItem>
            {(["A", "B", "C"] as const).map((k) => (
              <SelectItem key={k} value={k}>
                {tKelas("kelas", { kelas: k })}
              </SelectItem>
            ))}
            <SelectItem value="TANPA">{tKelas("tanpa")}</SelectItem>
          </SelectContent>
        </Select>
        {jumlahPerubahan > 0 || perubahanMenunggu ? (
          <Button
            type="button"
            size="sm"
            variant={perubahanMenunggu ? "default" : "outline"}
            aria-pressed={perubahanMenunggu}
            onClick={() => pushParam("perubahan", perubahanMenunggu ? undefined : "menunggu")}
          >
            {tList("filterPendingChanges", { count: jumlahPerubahan })}
          </Button>
        ) : null}
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-inactive"
            aria-label={tList("showInactive")}
            checked={showInactive}
            onCheckedChange={(checked) => toggleShowInactive(checked === true)}
          />
          <Label htmlFor="show-inactive" className="text-sm font-normal cursor-pointer">
            {tList("showInactive")}
          </Label>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            {tList("cardTitle")}
            <span className="text-sm font-normal text-muted-foreground ml-2">
              ({tList("count", { count: totalCount })})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stores.length === 0 ? (
            <div className="text-center py-12">
              <Store className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {search || showInactive || areaFilter || salesFilter || kelasFilter || perubahanMenunggu
                  ? tList("noSearchResults")
                  : tList("empty")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tTable("code")}</TableHead>
                    <TableHead>{tTable("name")}</TableHead>
                    <TableHead>{tTable("area")}</TableHead>
                    <TableHead>{tKelas("kolom")}</TableHead>
                    <TableHead>{tTable("salesman")}</TableHead>
                    <TableHead>{tTable("terms")}</TableHead>
                    <TableHead className="text-right">{tTable("tempo")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{tTable("margin")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{tTable("address")}</TableHead>
                    <TableHead>{tTable("status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stores.map(s => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        startTransition(() => router.push(`/backoffice/stores/${s.id}`))
                      }
                    >
                      <TableCell className="font-mono text-xs">{s.code}</TableCell>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-2">
                          {s.name}
                          {pendingSet.has(s.id) && (
                            <Badge variant="secondary" className="border-amber-500/40 text-amber-700">
                              {tChange("listBadge")}
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {s.groupId ? kodeArea.get(s.groupId) ?? "—" : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {s.storeClass ? (
                          <Badge variant="outline" className="font-mono">
                            {s.storeClass}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.salesmanId ? (
                          namaPemegang[s.salesmanId] ?? tTable("unknownSales")
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400">{tTable("noSales")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.termsType === "PUTUS" ? "outline" : "secondary"}>
                          {s.termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{tTable("tempoDays", { days: s.paymentTempo })}</TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{s.marginPercent ?? "—"}</TableCell>
                      <TableCell className="hidden truncate max-w-[220px] text-muted-foreground 2xl:table-cell" title={s.address}>
                        {s.address}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.isActive ? "default" : "outline"}>
                          {s.isActive ? tTable("active") : tBadge("inactive")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {bolehKelola ? (
        <>
          <KelolaAreaDialog open={bukaArea} onOpenChange={setBukaArea} areas={areas} />
          {/* Dipasang ulang setiap dibuka, supaya pilihannya mulai dari saringan
              daftar yang sedang aktif, bukan dari pilihan rotasi sebelumnya. */}
          {bukaPindah ? (
            <PindahTokoDialog
              open
              onOpenChange={setBukaPindah}
              areas={areas.filter((a) => a.isActive)}
              salesmen={salesmen}
              awalArea={areaFilter || undefined}
              awalDari={salesFilter || undefined}
            />
          ) : null}
        </>
      ) : null}

      <Pager
        page={page}
        pageSize={pageSize}
        total={totalCount}
        onPageChange={(p) => {
          const params = new URLSearchParams(sp.toString());
          params.set("page", String(p));
          startTransition(() => router.push(`/backoffice/stores?${params.toString()}`));
        }}
        onPageSizeChange={(size) => {
          const params = new URLSearchParams(sp.toString());
          params.set("pageSize", String(size));
          params.delete("page");
          startTransition(() => router.push(`/backoffice/stores?${params.toString()}`));
        }}
      />
    </div>
  );
}
