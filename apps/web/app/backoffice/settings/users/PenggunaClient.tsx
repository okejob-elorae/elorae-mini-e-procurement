"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Pencil, Search, UserPlus, Users } from "lucide-react";
import { simpanPenggunaAction, type KodeSimpanPengguna } from "@/app/actions/settings/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SANDI_MIN } from "@/lib/users/validasi";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";

type Pengguna = { id: string; nama: string; email: string; roleId: string | null; tokoId: string | null; punyaSandi: boolean };
type Peran = { id: string; nama: string; sistem: boolean; spg: boolean };
type Toko = { id: string; name: string; code: string };
type Draf = { id: string | null; nama: string; email: string; roleId: string; tokoId: string | null; sandi: string; ulangSandi: string };

const KOSONG: Draf = { id: null, nama: "", email: "", roleId: "", tokoId: null, sandi: "", ulangSandi: "" };

export function PenggunaClient({
  sayaId,
  pengguna,
  peran,
  toko,
}: {
  sayaId: string;
  pengguna: Pengguna[];
  peran: Peran[];
  toko: Toko[];
}) {
  const t = useTranslations("settings.users");
  const router = useRouter();
  const [cari, setCari] = useState("");
  const [draf, setDraf] = useState<Draf | null>(null);
  const [galat, setGalat] = useState<KodeSimpanPengguna[]>([]);
  const [lihatSandi, setLihatSandi] = useState(false);
  const [sibuk, mulai] = useTransition();

  const peranById = useMemo(() => new Map(peran.map((p) => [p.id, p])), [peran]);
  const tokoById = useMemo(() => new Map(toko.map((s) => [s.id, s])), [toko]);
  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return q ? pengguna.filter((u) => u.nama.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) : pengguna;
  }, [pengguna, cari]);

  const peranDipilih = draf ? peranById.get(draf.roleId) : undefined;
  const ubahSendiri = draf?.id === sayaId;

  const buka = (d: Draf) => {
    setGalat([]);
    setLihatSandi(false);
    setDraf(d);
  };

  const simpan = () => {
    if (!draf) return;
    mulai(async () => {
      const r = await simpanPenggunaAction(draf);
      if (!r.ok) {
        setGalat(r.codes);
        return;
      }
      toast.success(draf.id ? t("updated") : t("created"));
      setDraf(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <TombolBantuan judul={t("title")} />
        </div>
        <Button onClick={() => buka({ ...KOSONG })}>
          <UserPlus className="h-4 w-4" />
          {t("add")}
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="pl-9" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("listTitle")}
            <span className="ml-2 text-sm font-normal text-muted-foreground">({t("count", { count: pengguna.length })})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tampil.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colName")}</TableHead>
                    <TableHead>{t("colEmail")}</TableHead>
                    <TableHead>{t("colRole")}</TableHead>
                    <TableHead>{t("colStore")}</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tampil.map((u) => {
                    const p = u.roleId ? peranById.get(u.roleId) : undefined;
                    const s = u.tokoId ? tokoById.get(u.tokoId) : undefined;
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          {u.nama || "—"}
                          {u.id === sayaId ? <span className="ml-2 text-xs text-muted-foreground">({t("you")})</span> : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{u.email}</TableCell>
                        <TableCell>{p ? <Badge variant={p.sistem ? "default" : "secondary"}>{p.nama}</Badge> : "—"}</TableCell>
                        <TableCell className="whitespace-normal text-sm">{s ? s.name : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              buka({ id: u.id, nama: u.nama, email: u.email, roleId: u.roleId ?? "", tokoId: u.tokoId, sandi: "", ulangSandi: "" })
                            }
                          >
                            <Pencil className="h-4 w-4" />
                            {t("edit")}
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

      <Dialog open={draf !== null} onOpenChange={(o) => !o && !sibuk && setDraf(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draf?.id ? t("editTitle") : t("addTitle")}</DialogTitle>
            <DialogDescription>{draf?.id ? t("editDesc") : t("addDesc")}</DialogDescription>
          </DialogHeader>

          {draf ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                simpan();
              }}
            >
              {galat.length ? (
                <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                  {galat.map((g) => (
                    <li key={g}>{t(`err.${g}`, { min: SANDI_MIN })}</li>
                  ))}
                </ul>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="u-nama">{t("name")}</Label>
                <Input id="u-nama" value={draf.nama} maxLength={191} autoComplete="off" onChange={(e) => setDraf({ ...draf, nama: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-email">{t("email")}</Label>
                <Input
                  id="u-email"
                  type="email"
                  value={draf.email}
                  maxLength={191}
                  autoComplete="off"
                  onChange={(e) => setDraf({ ...draf, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-peran">{t("role")}</Label>
                <Select value={draf.roleId || undefined} onValueChange={(v) => setDraf({ ...draf, roleId: v })} disabled={ubahSendiri}>
                  <SelectTrigger id="u-peran" className="w-full">
                    <SelectValue placeholder={t("rolePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {peran.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nama}
                        {p.sistem ? ` — ${t("roleFullAccess")}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ubahSendiri ? <p className="text-xs text-muted-foreground">{t("roleSelfLocked")}</p> : null}
                {peranDipilih?.sistem && !ubahSendiri ? (
                  <p className="text-xs text-amber-800 dark:text-amber-300">{t("roleSystemWarning")}</p>
                ) : null}
              </div>

              {peranDipilih?.spg ? (
                <div className="space-y-1.5">
                  <Label htmlFor="u-toko">{t("store")}</Label>
                  <Select value={draf.tokoId ?? undefined} onValueChange={(v) => setDraf({ ...draf, tokoId: v })}>
                    <SelectTrigger id="u-toko" className="w-full">
                      <SelectValue placeholder={t("storePlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {toko.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} · {s.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("storeHint")}</p>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="u-sandi">{draf.id ? t("newPassword") : t("password")}</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLihatSandi((x) => !x)}>
                    {lihatSandi ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    {lihatSandi ? t("hide") : t("show")}
                  </Button>
                </div>
                <Input
                  id="u-sandi"
                  type={lihatSandi ? "text" : "password"}
                  value={draf.sandi}
                  autoComplete="new-password"
                  onChange={(e) => setDraf({ ...draf, sandi: e.target.value })}
                />
                <Input
                  id="u-sandi2"
                  aria-label={t("passwordRepeat")}
                  placeholder={t("passwordRepeat")}
                  type={lihatSandi ? "text" : "password"}
                  value={draf.ulangSandi}
                  autoComplete="new-password"
                  onChange={(e) => setDraf({ ...draf, ulangSandi: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {draf.id ? t("passwordKeepHint", { min: SANDI_MIN }) : t("passwordHint", { min: SANDI_MIN })}
                </p>
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDraf(null)} disabled={sibuk}>
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={sibuk || !draf.roleId}>
                  {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("save")}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
