import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { getStore, listVisitsForStore, getActiveVisit, listVisitPhotos } from "@/lib/stores/queries";
import { getPendingStoreChangeRequest } from "@/lib/store-changes/queries";
import { getStoreOrderSummary } from "@/lib/field-sales/queries";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { ringkasanToko } from "@/lib/salesman/ringkasan-toko";
import { polaPesanan } from "@/lib/salesman/dasbor";
import { saranPesananToko, tokoTerkunci } from "@/lib/salesman/queries";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bolehPegangToko } from "@/lib/stores/penanggung-jawab";
import { BukanTokoSaya } from "./BukanTokoSaya";
import { StoreDetailShell } from "./StoreDetailShell";
import { saranTawarToko } from "@/lib/salesman/saran-tawar-queries";
import { SaranTawar } from "./SaranTawar";
import { kartuStokDiToko } from "@/lib/konsinyasi/stok-di-toko";
import { StokDiToko } from "./StokDiToko";
import { izinJarakJauh } from "@/lib/field-sales/jarak-jauh-toko";
import { TombolPortalToko } from "./TombolPortalToko";
import { aksesCatatanToko, catatanTokoUntuk } from "@/lib/stores/catatan-queries";
import { CatatanToko } from "./CatatanToko";
import { jendelaIndenTerbuka } from "@/lib/field-sales/inden-queries";
import { TombolPreorder } from "./TombolPreorder";
import { LanjutSetelahCheckIn } from "./LanjutSetelahCheckIn";
import { kehadiranSpgToko, tampilKehadiran } from "@/lib/spg/kehadiran-toko";
import { KehadiranSpgToko } from "./KehadiranSpgToko";
import { LaporDariToko } from "./UbinLapor";
import { bacaPesananKonsiCadanganLama, muatPenerimaToko } from "@/lib/field-sales/konsi-transfer/pesanan-lama";
import { PesananLamaToko } from "./PesananLamaToko";
import { perkiraanPesananKonsi } from "@/lib/field-sales/perkiraan-konsi-queries";
import { hargaKonsiHp } from "@/lib/field-sales/perkiraan-konsi";
import { jumlahSpgToko, kirimanMenunggu } from "@/lib/spg/kiriman";
import { KirimanMenungguToko } from "./KirimanMenungguToko";

export const dynamic = "force-dynamic";

/** Jam diformat di server, WIB — format di klien bisa berbeda antara Node dan Safari. */
const JAM_WIB = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

export default async function PwaStoreDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const { id } = await params;

  // SPG hanya punya satu toko tetap. Toko lain — lewat tautan lama atau alamat
  // yang diketik — dikembalikan ke beranda SEBELUM baris toko itu dibaca:
  // halaman ini membawa markup, tempo, riwayat kunjungan, dan pesanan toko.
  const [terkunci, tokoTetap] = await Promise.all([tokoTerkunci(), ambilTokoTetap(session.user.id)]);
  if (tokoTetap && tokoTetap !== id) redirect("/pwa");

  const store = await getStore(id);
  if (!store) notFound();

  // Kunci "hanya toko sendiri" berlaku untuk salesman; SPG sudah dijaga di atas.
  if (!tokoTetap && !bolehPegangToko({ terkunci, penanggungJawabId: store.salesmanId, userId: session.user.id })) {
    return <BukanTokoSaya nama={store.name} />;
  }

  const sekarang = new Date();
  const [active, history, orderRows, saran, ringkasan, kehadiranSpg] = await Promise.all([
    getActiveVisit(session.user.id),
    listVisitsForStore(store.id, 20),
    // SPG tidak mengambil pesanan lapangan — riwayat pesanan toko tidak ditampilkan untuknya.
    tokoTetap ? Promise.resolve([]) : getStoreOrderSummary(store.id),
    saranPesananToko(store.id, sekarang),
    // Kartu ringkasan untuk salesman keliling. SPG tidak menagih dan tidak
    // mengambil pesanan lapangan — kartunya tidak berguna baginya.
    tokoTetap ? Promise.resolve(null) : ringkasanToko(store.id, { penontonId: session.user.id, hariIni: sekarang }),
    // Kehadiran SPG toko ini hari ini — untuk salesman. Kartu pelengkap: kalau
    // kuerinya gagal, halaman toko tetap tampil tanpa kartu ini.
    tokoTetap
      ? Promise.resolve([])
      : kehadiranSpgToko(store.id, sekarang).catch((e: unknown) => {
          console.error("[toko] kehadiran SPG gagal dimuat", e);
          return [];
        }),
  ]);
  const pola = polaPesanan(saran.tanggalPesanan, sekarang);

  const activeForStore = active && active.storeId === store.id ? active : null;
  const activePhotos = activeForStore ? await listVisitPhotos(activeForStore.id) : [];
  const pending = await getPendingStoreChangeRequest(store.id);
  // Tombol "Pesanan jarak jauh" hanya untuk salesman yang TIDAK sedang di toko
  // ini (yang sedang check-in memakai katalog biasa), dan hanya kalau aturan
  // pemilik mengizinkan — penilaian yang sama dengan penulis pesanan.
  const jarakJauh = tokoTetap || activeForStore ? null : await izinJarakJauh(store.id, session.user.id);
  // Pre-order (inden) hanya untuk toko PUTUS, dan hanya selama ada jendela yang buka.
  const indenBuka = store.termsType === "PUTUS" && !tokoTetap ? await jendelaIndenTerbuka(sekarang) : [];
  const preorder =
    indenBuka.length > 0 ? (
      <TombolPreorder
        storeId={store.id}
        jendela={indenBuka.map((j) => ({ id: j.id, name: j.name, tutup: formatDisplayDate(j.closesAt) }))}
      />
    ) : null;
  // Catatan toko — kartu pelengkap; kalau gagal dimuat, halaman toko tetap tampil.
  const catatanToko = await (async () => {
    const akses = await aksesCatatanToko({ id: session.user.id, permissions: session.user.permissions }, store.id);
    if (!akses.boleh) return null;
    const catatan = await catatanTokoUntuk(store.id, { userId: session.user.id, kelolaSemua: akses.kelolaSemua });
    return <CatatanToko storeId={store.id} catatan={catatan} />;
  })().catch((e: unknown) => {
    console.error("[toko] catatan toko gagal dimuat", e);
    return null;
  });

  // Pesanan konsinyasi LAMA yang cadangannya masih ditahan: "konfirmasi barang sudah sampai".
  // Salesman saja — SPG mengonfirmasinya dari Terima kiriman. Kartu pelengkap: kalau gagal
  // dimuat, halaman toko tetap tampil tanpa kartu ini.
  const pesananLama = tokoTetap
    ? null
    : await (async () => {
        const [lama, penerima] = await Promise.all([
          bacaPesananKonsiCadanganLama(prisma, { storeIds: [store.id] }),
          muatPenerimaToko(prisma, store.id),
        ]);
        if (lama.size === 0) return null;
        return (
          <PesananLamaToko
            storeId={store.id}
            pesanan={[...lama.values()].map((o) => ({
              id: o.orderId,
              orderNo: o.orderNo,
              disetujuiLabel: formatDisplayDate(o.approvedAt),
              jumlahBarang: o.baris.length,
              pcs: o.jumlahPcs,
            }))}
            penerima={penerima.penerima}
            sayaPemegang={penerima.pemegangTokoId === session.user.id}
            sudahCheckIn={activeForStore !== null}
          />
        );
      })().catch((e: unknown) => {
        console.error("[toko] pesanan konsi lama gagal dimuat", e);
        return null;
      });

  // Kiriman gudang yang sudah diserahkan ke toko TANPA SPG (SPG-nya berhenti, P45/P45a) tetapi
  // belum diterima: salesman pemegang mencatat penerimaannya saat berkunjung. Kartu pelengkap —
  // kalau gagal dimuat, halaman toko tetap tampil tanpa kartu ini.
  const kirimanPemegang =
    !tokoTetap && activeForStore && store.salesmanId === session.user.id
      ? await (async () => {
          if ((await jumlahSpgToko(prisma, store.id)) > 0) return null;
          const kiriman = (await kirimanMenunggu(store.id, sekarang)).filter(
            (k) => (k.sourceType === "KONSI_TRANSFER" || k.sourceType === "PUTUS_DELIVERY") && k.diserahkan === true,
          );
          if (kiriman.length === 0) return null;
          return (
            <KirimanMenungguToko
              storeId={store.id}
              kiriman={kiriman.map((k) => ({
                sourceType: k.sourceType as "KONSI_TRANSFER" | "PUTUS_DELIVERY",
                sourceId: k.sourceId,
                docNo: k.docNo,
                tanggalLabel: formatDisplayDate(k.tanggal),
                pcs: k.lines.reduce((s, l) => s + l.qty, 0),
              }))}
            />
          );
        })().catch((e: unknown) => {
          console.error("[toko] kiriman menunggu pemegang gagal dimuat", e);
          return null;
        })
      : null;

  // Tautan portal pesan mandiri: hanya pemegang toko yang membagikannya ke tokonya sendiri.
  const portalToko =
    !tokoTetap && store.salesmanId === session.user.id ? (
      <TombolPortalToko storeId={store.id} namaToko={store.name} teleponToko={store.phone} />
    ) : null;
  // Stok titipan + saran isi ulang — hanya untuk salesman di toko KONSINYASI
  // (SPG punya layar stoknya sendiri).
  const stokKonsi =
    store.termsType === "KONSI" && !tokoTetap
      ? await kartuStokDiToko(store.id, sekarang).catch((e: unknown) => {
          console.error("kartuStokDiToko", e);
          return null;
        })
      : null;
  // Harga retail konsi per barang untuk lembar isi ulang (P18, R26). Kartu stoknya
  // sendiri hanya membawa jumlah — baris stok tetap tanpa nilai — jadi harganya
  // dibaca di sini, dengan rumus yang sama dengan katalog dan persetujuan kantor.
  // Hanya salesman: `stokKonsi` selalu null untuk SPG. Gagal dibaca = tanpa harga.
  const hargaStokKonsi: Record<string, number | null> = {};
  if (stokKonsi && stokKonsi.baris.length > 0) {
    const barang = await prisma.item
      .findMany({
        where: { id: { in: [...new Set(stokKonsi.baris.map((b) => b.itemId))] } },
        select: { id: true, sellingPrice: true },
      })
      .catch((e: unknown) => {
        console.error("[toko] harga stok konsi gagal dimuat", e);
        return [];
      });
    for (const b of barang) {
      hargaStokKonsi[b.id] = hargaKonsiHp(b.sellingPrice == null ? null : Number(b.sellingPrice), store.markupPercent);
    }
  }
  // "Yang perlu ditawarkan" — hanya salesman keliling. Kartu pelengkap: kalau
  // kuerinya gagal, halaman toko tetap tampil tanpa kartu ini.
  const saranTawar = tokoTetap
    ? null
    : await saranTawarToko(store.id, sekarang).catch((e: unknown) => {
        console.error("saranTawarToko", e);
        return null;
      });

  // P18: pesanan konsinyasi yang sudah disetujui menampilkan nilainya di HP
  // salesman; yang masih menunggu menampilkan perkiraan dari harga retail toko.
  // SPG tidak mendapat daftar pesanan sama sekali (`orderRows` kosong).
  const perkiraanKonsi = await perkiraanPesananKonsi(
    orderRows.filter((o) => o.orderType === "KONSI" && o.status === "PENDING_APPROVAL").map((o) => o.id),
  );
  const orders = orderRows.map(o => ({
    id: o.id,
    orderNo: o.orderNo,
    orderType: o.orderType,
    status: o.status,
    total: o.orderType === "KONSI" && o.status !== "APPROVED" ? null : o.total,
    perkiraan: perkiraanKonsi.get(o.id) ?? null,
    createdLabel: formatDisplayDateTime(o.createdAtIso),
  }));
  const pemegang = !tokoTetap && store.salesmanId === session.user.id;

  /*
   * Semua tanggal di halaman ini diformat DI SERVER: format tanggal di klien
   * bisa berbeda antara Node dan Safari, dan React menganggapnya hydration error.
   */
  const ringkasanView = ringkasan
    ? {
        storeId: store.id,
        jenisToko: ringkasan.jenisToko,
        tagihan: ringkasan.tagihan
          ? {
              sisa: ringkasan.tagihan.sisa,
              fakturTerbuka: ringkasan.tagihan.fakturTerbuka,
              lewatJanji: ringkasan.tagihan.lewatJanji,
              fakturLewatJanji: ringkasan.tagihan.fakturLewatJanji,
              lebih: ringkasan.tagihan.lebih,
              bolehLihat: ringkasan.tagihan.bolehLihat,
              belumDinota: ringkasan.tagihan.belumDinota,
              faktur: ringkasan.tagihan.faktur.map((f) => ({ ...f, tanggal: formatDisplayDate(f.tanggal) })),
            }
          : null,
        tagihanHanyaPemegang: ringkasan.tagihanHanyaPemegang,
        favorit: ringkasan.favorit.map((f) => ({ itemId: f.itemId, nama: f.nama, pcs: f.pcs })),
        pesananTerakhir: ringkasan.pesananTerakhir
          ? {
              id: ringkasan.pesananTerakhir.id,
              orderNo: ringkasan.pesananTerakhir.orderNo,
              tanggal: formatDisplayDate(ringkasan.pesananTerakhir.tanggal),
              keadaan: ringkasan.pesananTerakhir.keadaan,
              total: ringkasan.pesananTerakhir.total,
              perkiraan: ringkasan.pesananTerakhir.perkiraan,
              milikSaya: ringkasan.pesananTerakhir.milikSaya,
            }
          : null,
        kunjunganTerakhir: ringkasan.kunjunganTerakhir
          ? {
              tanggal: formatDisplayDateTime(ringkasan.kunjunganTerakhir.tanggal),
              oleh: ringkasan.kunjunganTerakhir.oleh,
              olehSaya: ringkasan.kunjunganTerakhir.olehSaya,
            }
          : null,
      }
    : null;

  return (
    <>
      {/* SPG yang baru check-in dari "check-in dulu" diteruskan ke layar asalnya. */}
      {tokoTetap && activeForStore ? <LanjutSetelahCheckIn storeId={store.id} /> : null}
      <StoreDetailShell
        store={{
          id: store.id,
          code: store.code,
          name: store.name,
          address: store.address,
          phone: store.phone,
          contactName: store.contactName,
          termsType: store.termsType,
          paymentTempo: store.paymentTempo,
          // Markup konsinyasi tidak ditampilkan di layar mana pun, dan SPG tidak
          // memerlukannya — jangan dikirim ke HP-nya.
          markupPercent: tokoTetap ? null : store.markupPercent,
          lat: store.lat,
          lng: store.lng,
        }}
        active={active ? {
          id: active.id,
          storeId: active.storeId,
          storeName: active.store.name,
          checkinOutOfRadius: active.checkinOutOfRadius,
          checkinDistanceMeters: active.checkinDistanceMeters,
          sejakLabel: JAM_WIB.format(active.checkinAt),
        } : null}
        activePhotos={activePhotos.map((p) => ({
          id: p.id,
          url: p.url,
          caption: p.caption,
          capturedAtIso: p.capturedAt.toISOString(),
        }))}
        ringkasan={ringkasanView}
        history={history.map(v => ({
          id: v.id,
          checkinLabel: formatDisplayDateTime(v.checkinAt),
          checkoutLabel: v.checkoutAt ? formatDisplayDateTime(v.checkoutAt) : null,
          checkinLat: v.checkinLat,
          checkinLng: v.checkinLng,
          autoClosed: v.autoClosed,
          userLabel: v.user.name ?? v.user.email,
        }))}
        pending={pending ? { proposed: pending.proposed, old: pending.old, requestedByLabel: pending.requestedByLabel } : null}
        orders={orders}
        bolehJarakJauh={jarakJauh?.boleh === true}
        portalToko={portalToko}
        preorder={preorder}
        /*
         * Slot tepat di bawah ringkasan toko. Selain catatan toko, salesman
         * mendapat ubin lapor pelunasan/retur (di luar kunjungan — selama
         * kunjungan keduanya ada di kartu Kunjungan berjalan) dan kehadiran SPG
         * toko ini hari ini.
         */
        catatanToko={
          <>
            {kirimanPemegang}
            {pesananLama}
            {!tokoTetap && !activeForStore ? (
              <LaporDariToko storeId={store.id} termsType={store.termsType} pemegang={pemegang} />
            ) : null}
            <KehadiranSpgToko baris={tampilKehadiran(kehadiranSpg)} />
            {catatanToko}
          </>
        }
        stokDiToko={stokKonsi ? <StokDiToko data={stokKonsi} hargaKonsi={hargaStokKonsi} storeId={store.id} visitId={activeForStore?.id ?? null} /> : null}
        saranTawar={saranTawar ? <SaranTawar storeId={store.id} data={saranTawar} /> : null}
        spg={!!tokoTetap}
        pemegang={pemegang}
        saran={{
          pola: { hariSejak: pola.hariSejak, jedaMedian: pola.jedaMedian, waktunya: pola.waktunya },
          terakhir: saran.terakhir
            ? {
                id: saran.terakhir.id,
                orderNo: saran.terakhir.orderNo,
                tanggalIso: saran.terakhir.tanggal.toISOString(),
                baris: saran.terakhir.baris.map((b) => ({ productName: b.productName, variantSku: b.variantSku, qty: b.qty })),
              }
            : null,
          promo: saran.promo.map((x) => ({ ...x, type: x.type as "PERCENT" | "FIXED" | "TIERED" })),
        }}
      />
    </>
  );
}
