import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { muatIsiKeranjang } from "@/lib/field-sales/isi-keranjang";
import { bacaSumberKeranjang, tulisSumberKeranjang } from "@/lib/field-sales/isi-keranjang-sumber";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { getStore, getActiveVisit } from "@/lib/stores/queries";
import { barisPesananUntukUlang } from "@/lib/salesman/queries";
import { muatKreditToko } from "@/lib/field-sales/kredit-toko";
import { muatMinimumKatalog } from "@/lib/field-sales/minimum-toko";
import { bacaSaluran } from "@/lib/field-sales/jarak-jauh";
import { izinJarakJauh } from "@/lib/field-sales/jarak-jauh-toko";
import { formatDisplayDate } from "@/lib/date-only";
import { bacaIdInden, rentangKirim } from "@/lib/field-sales/inden";
import { jendelaIndenTerbuka, jendelaUntukKatalog } from "@/lib/field-sales/inden-queries";
import { bacaIdGanti } from "@/lib/field-sales/ganti-pesanan";
import { pesananUntukDiganti } from "@/lib/field-sales/pwa-queries";
import { getPackRatio } from "@/app/actions/settings/pack-ratio";
import { muatUkuranPack } from "./ukuran-pack";
import { CatalogShell, type GantiKatalog, type IndenKatalog, type IndenTerbukaKatalog, type KreditKatalog } from "./CatalogShell";

export const dynamic = "force-dynamic";

export default async function PwaStoreCatalog({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ulang?: string; jarakJauh?: string; q?: string; inden?: string; ganti?: string; isi?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  // Pesanan dan tukar barang milik salesman keliling: SPG menjual dari layarnya sendiri.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");
  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  const active = await getActiveVisit(session.user.id);
  const hasActiveVisit = active?.storeId === store.id;
  const { ulang, jarakJauh: rawJarakJauh, q, inden: rawInden, ganti: rawGanti, isi: rawIsi } = await searchParams;

  /*
   * Ubah pesanan (`?ganti=<id>`): pesanan sendiri yang MASIH menunggu diisi
   * ulang ke keranjang; mengirim = pesanan baru + pesanan lama dibatalkan di
   * satu transaksi. Saluran jarak jauh dan jendela pre-order DIBAWA dari pesanan
   * lama (alamat diabaikan untuk keduanya) — penulis melakukan hal yang sama,
   * jadi layar dan server tidak berbeda pendapat. Pesanan yang sudah diputuskan
   * kantor (atau bukan miliknya) tidak diisi; katalog menjelaskannya.
   */
  const idGanti = rawGanti !== undefined ? bacaIdGanti(rawGanti) : null;
  const lama = idGanti ? await pesananUntukDiganti(idGanti, session.user.id, store.id) : null;
  const gantiAktif = lama?.status === "PENDING_APPROVAL" ? lama : null;
  let ganti: GantiKatalog | null = null;
  if (rawGanti !== undefined) {
    ganti = gantiAktif
      ? {
          mode: "UBAH",
          id: gantiAktif.id,
          orderNo: gantiAktif.orderNo,
          portal: gantiAktif.remoteChannel === "PORTAL",
          note: gantiAktif.note,
          cadangan: gantiAktif.cadangan,
        }
      : { mode: "DITOLAK", orderNo: lama?.orderNo ?? null };
  }

  /*
   * Pesanan jarak jauh (`?jarakJauh=WA|TELEPON|LAINNYA`): toko memesan lewat
   * WhatsApp/telepon, jadi katalog menerima pesanan tanpa check-in. Aturan
   * pemilik dinilai DI SINI dengan penilaian yang sama dengan penulis pesanan,
   * supaya salesman diberi tahu sebelum mengisi keranjang — server tetap menilai
   * ulang saat pesanan dibuat.
   */
  const saluran = gantiAktif ? bacaSaluran(gantiAktif.remoteChannel) : bacaSaluran(rawJarakJauh);
  const izin = saluran ? await izinJarakJauh(store.id, session.user.id) : null;
  const jarakJauh = saluran && izin?.boleh ? { saluran } : null;
  const jarakJauhDitolak = izin && !izin.boleh ? izin.alasan : null;
  // Mengubah pesanan kunjungan tidak butuh check-in baru: server membawa kunjungan lamanya.
  const bisaPesan = hasActiveVisit || jarakJauh !== null || (gantiAktif !== null && jarakJauhDitolak === null);

  // "Ulangi pesanan terakhir" dari kartu saran pesanan. Tanpa check-in (dan
  // bukan pesanan jarak jauh) katalog tidak menerima pesanan, jadi baris ulangnya
  // juga tidak dimuat.
  /*
   * Pre-order (`?inden=<id>`): katalog berisi barang jendela itu saja, tanpa
   * batas stok. Keadaan jendela dinilai DI SINI supaya salesman tahu sebelum
   * mengisi keranjang; penulis pesanan menilainya ulang saat pesanan dibuat.
   * Toko konsinyasi tidak punya pre-order — harga konsinyasi juga tidak pernah
   * dimuat untuk HP (`jendelaUntukKatalog` menolak toko KONSI).
   */
  const indenId = gantiAktif
    ? gantiAktif.preorderWindowId
    : ganti?.mode === "DITOLAK"
      ? null
      : rawInden !== undefined
        ? (bacaIdInden(rawInden) ?? "")
        : null;
  let inden: IndenKatalog | null = null;
  if (indenId !== null) {
    if (store.termsType === "KONSI") {
      inden = { mode: "DITOLAK", alasan: "KONSI", name: null };
    } else {
      const j = indenId ? await jendelaUntukKatalog(indenId, { termsType: store.termsType, marginPercent: store.marginPercent }) : null;
      if (!j) inden = { mode: "DITOLAK", alasan: "TIDAK_ADA", name: null };
      else if (j.keadaan !== "BUKA") inden = { mode: "DITOLAK", alasan: j.keadaan, name: j.name };
      else
        inden = {
          mode: "PESAN",
          id: j.id,
          name: j.name,
          tutup: formatDisplayDate(j.closesAt),
          kirim: rentangKirim(j.shipFrom, j.shipTo),
          items: j.items,
        };
    }
  }
  // Katalog stok siap toko PUTUS: jendela yang sedang buka, untuk pintu masuk "Pre-order" dan tanda "juga bisa pre-order".
  const indenTerbuka: IndenTerbukaKatalog[] =
    // Mengubah pesanan tidak berpindah ke pre-order: jendelanya dibawa dari pesanan lama.
    indenId === null && store.termsType === "PUTUS" && !gantiAktif
      ? (await jendelaIndenTerbuka()).map((j) => ({
          id: j.id,
          name: j.name,
          tutup: formatDisplayDate(j.closesAt),
          kirim: rentangKirim(j.shipFrom, j.shipTo),
          itemIds: j.itemIds,
        }))
      : [];

  /*
   * Keranjang diisi dari permintaan SPG atau rekomendasi yang diterima toko
   * (`?isi=permintaan:<id>` / `?isi=rekomendasi:<id>`) — hanya diisi; salesman
   * tetap meninjau dan mengirim, dan pesanannya ditautkan ke sumbernya.
   */
  const sumberIsi = !gantiAktif && bisaPesan && indenId === null ? bacaSumberKeranjang(rawIsi) : null;
  const barisSumber = sumberIsi ? await muatIsiKeranjang(sumberIsi, { userId: session.user.id, storeId: store.id }) : null;
  const isiAwal = gantiAktif
    ? bisaPesan
      ? gantiAktif.baris
      : null
    : barisSumber
      ? barisSumber
      : ulang && bisaPesan && indenId === null
        ? await barisPesananUntukUlang(ulang, store.id)
        : null;

  // Bahan peringatan kredit di layar tinjau — hanya toko PUTUS (konsinyasi tidak
  // punya piutang). Nilainya dihitung ulang di HP setiap keranjang berubah, dengan
  // aturan yang sama persis dengan yang dipakai server saat pesanan dibuat. Tanpa
  // check-in keranjang tidak bisa diisi, jadi tagihan toko tidak perlu dihitung.
  const kt = store.termsType === "PUTUS" && bisaPesan ? await muatKreditToko(store.id) : null;
  const kredit: KreditKatalog | null = kt ? { aturan: kt.aturan, batas: kt.batas, keadaan: kt.keadaan } : null;

  // Minimum yang berlaku di toko ini (pesanan pertama vs pesan ulang). Konsinyasi tanpa minimum.
  const minimum = store.termsType === "PUTUS" ? await muatMinimumKatalog(store.id) : null;

  // "+1 pack" di lembar varian: rasio global + ukuran varian (PUTUS dan KONSI — hanya jumlah, tanpa harga).
  const rasioPack = await getPackRatio();
  const petaUkuran = await muatUkuranPack(rasioPack);

  return (
    <CatalogShell
      // Pindah antara stok siap dan pre-order memasang katalog baru: keranjang
      // stok siap tidak boleh terbawa menjadi pesanan pre-order (dan sebaliknya).
      key={`${inden?.mode === "PESAN" ? `inden-${inden.id}` : indenId !== null ? "inden-tolak" : "stok-siap"}${ganti?.mode === "UBAH" ? `-ganti-${ganti.id}` : ""}`}
      storeId={store.id}
      storeName={store.name}
      userId={session.user.id}
      // Keranjang dari dokumen (`?ganti=` pesanan yang diubah, `?isi=` permintaan SPG /
      // rekomendasi) ditentukan dokumen itu: tidak dipulihkan dan tidak menimpa simpanan.
      simpanKeranjang={rawGanti === undefined && rawIsi === undefined}
      rasioPack={rasioPack}
      petaUkuran={petaUkuran}
      termsType={store.termsType}
      hasActiveVisit={hasActiveVisit}
      visitId={hasActiveVisit ? active!.id : null}
      checkinAtMs={hasActiveVisit ? active!.checkinAt.getTime() : null}
      isiAwal={isiAwal}
      sumber={sumberIsi && barisSumber ? tulisSumberKeranjang(sumberIsi) : null}
      kredit={kredit}
      minimum={minimum}
      jarakJauh={jarakJauh}
      jarakJauhDitolak={jarakJauhDitolak}
      // `?q=` — kata cari awal (mis. dari kartu "Yang perlu ditawarkan"): katalog terbuka sudah tersaring.
      cariAwal={typeof q === "string" ? q.slice(0, 100) : null}
      inden={inden}
      indenTerbuka={indenTerbuka}
      ganti={ganti}
    />
  );
}
