"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, Loader2, Search, UserPlus, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cariPelangganSpgAction, cekMemberNomorAction, type PelangganCari } from "@/app/actions/spg-pelanggan-cari";
import { formatIDR } from "@/lib/sales-orders/format";
import { nomorWhatsApp } from "@/lib/salesman/dasbor";
import type { AturanMember } from "@/lib/spg/member";
import type { MemberPembeli } from "@/lib/spg/member-hp";
import { memberDiketahui, nomorPerluCekMember, type PembeliKeranjang } from "./keranjang";

/** Jeda ketik sebelum mencari — satu panggilan per jeda, bukan per huruf. */
const JEDA_CARI_MS = 300;
/** Jeda sesudah nomor terakhir diketik sebelum keanggotaannya ditanyakan. */
const JEDA_CEK_MEMBER_MS = 400;

/** "62812…" (bentuk tersimpan) → "0812…" untuk dibaca orang. */
export function tampilHp(hp: string): string {
  return hp.startsWith("62") ? `0${hp.slice(2)}` : hp;
}

type Cari = { keadaan: "memuat" } | { keadaan: "gagal" } | { keadaan: "ada"; hasil: PelangganCari[] };

type UbahPembeli = Dispatch<SetStateAction<PembeliKeranjang | null>>;

/** Kalimat diskon member: persen yang sungguh dipotong, atau kenapa nol. */
function useTeksDiskon(aturan: AturanMember) {
  const t = useTranslations("pwa.spgJual.member");
  return (persen: number) => (persen > 0 ? t("diskon", { persen }) : aturan.diskonAktif ? t("diskonNol") : t("diskonMati"));
}

/** Keping kecil keanggotaan di hasil pencarian. */
function KepingMember({ member }: { member: MemberPembeli | undefined }) {
  const t = useTranslations("pwa.spgJual.member");
  if (member?.status === "MEMBER") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium">
        <BadgeCheck className="h-3 w-3" aria-hidden />
        {t("badge", { tingkat: member.tingkat })}
      </span>
    );
  }
  if (member?.status === "NONAKTIF") {
    return <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("nonaktifSingkat")}</span>;
  }
  return null;
}

/**
 * Keanggotaan pembeli di keranjang: tingkat dan diskonnya kalau sudah member,
 * atau sakelar "Daftarkan jadi member" (dengan persetujuan pembeli) selama
 * program menerima pendaftaran. Keadaannya dari server; tanpa sinyal layar
 * mengatakan bahwa tingkatnya dipastikan saat nota terkirim.
 */
function BlokMember({
  pembeli,
  onUbah,
  aturan,
  memeriksa,
  online,
  disabled,
  daftarKurang,
}: {
  pembeli: PembeliKeranjang;
  onUbah: UbahPembeli;
  aturan: AturanMember;
  memeriksa: boolean;
  online: boolean;
  disabled: boolean;
  daftarKurang: { minimal: number; kurang: number } | null;
}) {
  const t = useTranslations("pwa.spgJual.member");
  const teksDiskon = useTeksDiskon(aturan);
  const info = memberDiketahui(pembeli);

  if (info?.status === "MEMBER") {
    return (
      <div className="flex items-start gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm" aria-live="polite">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t("badge", { tingkat: info.tingkat })}</span>
          <span className="block text-xs text-muted-foreground">{teksDiskon(info.diskonPersen)}</span>
        </span>
      </div>
    );
  }
  if (info?.status === "NONAKTIF") {
    return <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{t("nonaktif")}</p>;
  }
  if (memeriksa && !info) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {t("memeriksa")}
      </p>
    );
  }
  // Program tidak menerima pendaftaran: tidak ada yang bisa dilakukan di konter.
  if (!aturan.aktif) return null;

  const id = `spg-daftar-member-${pembeli.jenis}`;
  return (
    <div className="space-y-2 rounded-md border px-3 py-2">
      <div className="flex min-h-11 items-center gap-3">
        <span className="min-w-0 flex-1 space-y-0.5">
          <Label htmlFor={id} className="block font-medium leading-tight">
            {t("daftar")}
          </Label>
          <span className="block text-xs text-muted-foreground">{t("daftarPersetujuan")}</span>
          {aturan.minBelanjaDaftar > 0 ? (
            <span className="block text-xs text-muted-foreground">{t("syaratBelanja", { minimal: formatIDR(aturan.minBelanjaDaftar) })}</span>
          ) : null}
        </span>
        <Switch
          id={id}
          checked={pembeli.daftarMember}
          disabled={disabled}
          onCheckedChange={(v) => onUbah((p) => (p ? { ...p, daftarMember: v } : p))}
        />
      </div>
      {pembeli.daftarMember ? (
        info?.status === "BUKAN" ? (
          <p className="text-xs" aria-live="polite">
            <span className="font-medium">{t("langsungJadi", { tingkat: info.tingkatDaftar })}</span>
            {" · "}
            <span className="text-muted-foreground">{teksDiskon(info.diskonPersenDaftar)}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{online ? t("tingkatNanti") : t("tingkatLuring")}</p>
        )
      ) : !info && !online ? (
        <p className="text-xs text-muted-foreground">{t("luringBelumTahu")}</p>
      ) : null}
      {pembeli.daftarMember && daftarKurang ? (
        <p className="text-xs text-amber-700 dark:text-amber-300" aria-live="polite">
          {t("belanjaKurang", { minimal: formatIDR(daftarKurang.minimal), kurang: formatIDR(daftarKurang.kurang) })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Pembeli pada nota (opsional): pilih pelanggan toko ini dari pencarian, atau
 * catat pembeli baru. Pembeli baru WAJIB setuju dihubungi lewat WhatsApp —
 * tanpa centang itu nota tidak bisa disimpan (persetujuan, UU PDP).
 *
 * Member dikenali dari nomornya di semua toko Elorae: begitu nomor pembeli
 * diketahui, keanggotaannya ditanyakan ke server (hanya tingkat dan diskon),
 * supaya total di HP sama dengan nota yang tercatat.
 *
 * Pencarian butuh sinyal; tanpa sinyal layar mengatakannya, dan pembeli baru
 * tetap bisa dicatat (ikut terkirim bersama notanya).
 */
export function IsianPembeli({
  pembeli,
  onUbah,
  online,
  disabled,
  aturanMember,
  daftarKurang,
}: {
  pembeli: PembeliKeranjang | null;
  onUbah: UbahPembeli;
  online: boolean;
  disabled: boolean;
  aturanMember: AturanMember;
  /** Dari pratinjau: nota di bawah belanja minimal untuk mendaftar, atau null. */
  daftarKurang: { minimal: number; kurang: number } | null;
}) {
  const t = useTranslations("pwa.spgJual.pembeli");
  const [mencari, setMencari] = useState(false);
  const [q, setQ] = useState("");
  const [cari, setCari] = useState<Cari | null>(null);
  // Nomor yang keanggotaannya gagal ditanyakan — tidak ditampilkan "memeriksa" selamanya;
  // ditanyakan lagi saat sinyal kembali atau nomornya diganti.
  const [gagalCek, setGagalCek] = useState<string | null>(null);
  const jeda = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Jawaban yang datang terlambat (ketikan lama) tidak menimpa hasil ketikan terbaru.
  const urutan = useRef(0);

  const perluCek = online ? nomorPerluCekMember(pembeli) : null;

  useEffect(
    () => () => {
      if (jeda.current) clearTimeout(jeda.current);
    },
    [],
  );

  // Keanggotaan nomor pembeli: ditanyakan sekali per nomor, sesudah jeda ketik.
  // Jawaban untuk nomor yang sudah diganti diabaikan.
  useEffect(() => {
    if (!perluCek) return;
    let batal = false;
    const id = setTimeout(() => {
      cekMemberNomorAction(perluCek).then(
        (res) => {
          if (batal) return;
          if (!res.ok) {
            setGagalCek(perluCek);
            return;
          }
          setGagalCek(null);
          onUbah((p) => (p && nomorWhatsApp(p.hp) === res.hp ? { ...p, member: { hp: res.hp, info: res.member } } : p));
        },
        () => {
          if (!batal) setGagalCek(perluCek);
        },
      );
    }, JEDA_CEK_MEMBER_MS);
    return () => {
      batal = true;
      clearTimeout(id);
    };
    // Tanpa sinyal `perluCek` kosong; begitu sinyal kembali nomornya ditanyakan lagi.
  }, [perluCek, onUbah]);

  function jalankanCari(teks: string) {
    const ke = ++urutan.current;
    setCari({ keadaan: "memuat" });
    cariPelangganSpgAction(teks, { member: true })
      .then((res) => {
        if (ke !== urutan.current) return;
        setCari(res.ok ? { keadaan: "ada", hasil: res.hasil } : { keadaan: "gagal" });
      })
      .catch(() => {
        if (ke === urutan.current) setCari({ keadaan: "gagal" });
      });
  }

  function mulaiCari() {
    setMencari(true);
    setQ("");
    // Tanpa kata kunci: pelanggan toko yang terakhir berbelanja.
    if (online) jalankanCari("");
  }

  function ketik(teks: string) {
    setQ(teks);
    if (jeda.current) clearTimeout(jeda.current);
    if (!online) return;
    jeda.current = setTimeout(() => jalankanCari(teks), JEDA_CARI_MS);
  }

  function tutupCari() {
    if (jeda.current) clearTimeout(jeda.current);
    urutan.current += 1;
    setMencari(false);
    setCari(null);
    setQ("");
  }

  const blokMember = (p: PembeliKeranjang) => (
    <BlokMember
      pembeli={p}
      onUbah={onUbah}
      aturan={aturanMember}
      memeriksa={perluCek !== null && perluCek === nomorWhatsApp(p.hp) && perluCek !== gagalCek}
      online={online}
      disabled={disabled}
      daftarKurang={daftarKurang}
    />
  );

  if (pembeli?.jenis === "ada") {
    return (
      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <UserRound className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{pembeli.nama}</p>
            <p className="text-xs tabular-nums text-muted-foreground">{tampilHp(pembeli.hp)}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onUbah(null)}>
            {t("change")}
          </Button>
        </div>
        {nomorWhatsApp(pembeli.hp) ? blokMember(pembeli) : null}
      </div>
    );
  }

  if (pembeli?.jenis === "baru") {
    const ubah = (bagian: Partial<Extract<PembeliKeranjang, { jenis: "baru" }>>) =>
      onUbah((p) => (p?.jenis === "baru" ? { ...p, ...bagian } : p));
    return (
      <section className="space-y-3 rounded-lg border p-3" aria-labelledby="spg-pembeli-baru">
        <div className="flex items-center justify-between gap-2">
          <h3 id="spg-pembeli-baru" className="text-sm font-semibold">
            {t("newTitle")}
          </h3>
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onUbah(null)}>
            <X className="h-4 w-4" aria-hidden />
            {t("cancel")}
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="spg-pembeli-nama">{t("name")}</Label>
          <Input
            id="spg-pembeli-nama"
            autoComplete="off"
            maxLength={100}
            value={pembeli.nama}
            disabled={disabled}
            onChange={(e) => ubah({ nama: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="spg-pembeli-hp">{t("phone")}</Label>
          <Input
            id="spg-pembeli-hp"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={30}
            value={pembeli.hp}
            disabled={disabled}
            placeholder="0812…"
            onChange={(e) => ubah({ hp: e.target.value })}
          />
        </div>
        <label htmlFor="spg-pembeli-setuju" className="flex items-start gap-3 text-sm">
          <Checkbox
            id="spg-pembeli-setuju"
            className="mt-0.5"
            checked={pembeli.setuju}
            disabled={disabled}
            onCheckedChange={(v) => ubah({ setuju: v === true })}
          />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("consent")}</span>
            <span className="block text-xs text-muted-foreground">{t("consentHint")}</span>
          </span>
        </label>
        {nomorWhatsApp(pembeli.hp) ? blokMember(pembeli) : null}
      </section>
    );
  }

  if (mencari) {
    return (
      <section className="space-y-2 rounded-lg border p-3" aria-labelledby="spg-pembeli-cari">
        <div className="flex items-center justify-between gap-2">
          <h3 id="spg-pembeli-cari" className="text-sm font-semibold">
            {t("searchTitle")}
          </h3>
          <Button type="button" variant="ghost" size="sm" onClick={tutupCari}>
            <X className="h-4 w-4" aria-hidden />
            {t("cancel")}
          </Button>
        </div>
        {online ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                autoComplete="off"
                enterKeyHint="search"
                className="pl-9"
                aria-label={t("searchPlaceholder")}
                placeholder={t("searchPlaceholder")}
                value={q}
                onChange={(e) => ketik(e.target.value)}
              />
            </div>
            {cari?.keadaan === "memuat" ? (
              <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("searching")}
              </p>
            ) : cari?.keadaan === "gagal" ? (
              <p className="py-2 text-sm text-destructive">{t("searchFailed")}</p>
            ) : cari?.keadaan === "ada" && cari.hasil.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{q.trim() ? t("noMatch") : t("noCustomers")}</p>
            ) : cari?.keadaan === "ada" ? (
              <ul className="divide-y rounded-md border">
                {cari.hasil.map((c) => (
                  <li key={c.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-h-11 w-full justify-start rounded-none px-3 py-2 text-left"
                      onClick={() => {
                        tutupCari();
                        onUbah({
                          jenis: "ada",
                          id: c.id,
                          nama: c.name,
                          hp: c.phone,
                          daftarMember: false,
                          member: c.member ? { hp: c.phone, info: c.member } : null,
                        });
                      }}
                    >
                      <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">{tampilHp(c.phone)}</span>
                        <KepingMember member={c.member} />
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("searchOffline")}</p>
        )}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            tutupCari();
            onUbah({
              jenis: "baru",
              nama: q.trim() && !/\d/.test(q) ? q.trim() : "",
              hp: /^\+?[\d\s-]+$/.test(q.trim()) ? q.trim() : "",
              setuju: false,
              daftarMember: false,
              member: null,
            });
          }}
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          {t("newButton")}
        </Button>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal py-2" disabled={disabled} onClick={mulaiCari}>
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        {t("searchButton")}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-11 whitespace-normal py-2"
        disabled={disabled}
        onClick={() => onUbah({ jenis: "baru", nama: "", hp: "", setuju: false, daftarMember: false, member: null })}
      >
        <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
        {t("newButton")}
      </Button>
    </div>
  );
}
