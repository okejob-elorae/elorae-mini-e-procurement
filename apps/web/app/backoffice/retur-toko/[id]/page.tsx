import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { kandidatPenanggung, rincianRetur, tokoUntukRetur } from "@/lib/receivables/return-queries";
import { RincianReturClient, type RincianBarangRetur, type TindakLanjutSelisih } from "./RincianReturClient";
import { prisma } from "@elorae/db";
import { formatDisplayDate } from "@/lib/date-only";
import { koreksiTertunda, penggantiUntuk, riwayatDokumen } from "@/lib/receivables/koreksi";
import { bolehMembacaRetur, bolehMemutuskanSelisihRetur } from "@/lib/receivables/izin";
import { bebanTokoDiNota } from "@/lib/receivables/return-writer";
import { kurangPerBarang } from "@/lib/receivables/selisih-retur";
import { pemegangSaatRetur } from "@/lib/receivables/pemegang-retur";
import type { CekSelisih } from "@/lib/receivables/rules";
import { klaimDisembunyikan, selisihDisembunyikan } from "../buta";

export const dynamic = "force-dynamic";

const nama = (u: { name: string | null; email: string } | null | undefined) => (u ? (u.name ?? u.email) : null);

export default async function RincianReturPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaRetur(session.user.permissions)) redirect("/backoffice");

  const { id } = await params;
  const izin = session.user.permissions ?? [];
  const penggunaId = session.user.id ?? "";
  const kelola = hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE);
  // Menetapkan siapa menanggung selisih retur = store_returns:decide_shortfall (putuskanBebanAction).
  const putusBeban = bolehMemutuskanSelisihRetur(izin);
  const bolehMenghitung = hasPermission(izin, PERMISSIONS.INVENTORY_OPNAME_COUNT);
  const [data, kandidat, tokoTujuan] = await Promise.all([
    rincianRetur(id),
    // Calon penanggung hanya dipakai dialog keputusan beban.
    putusBeban ? kandidatPenanggung() : Promise.resolve([]),
    kelola ? tokoUntukRetur() : Promise.resolve([]),
  ]);
  if (!data) notFound();

  // Tindak lanjut selisih: hasil cek sales pemegang toko, hitungan susulan, dan bebannya.
  const BARIS = { select: { itemId: true, variantSku: true, itemName: true, qty: true } } as const;
  const tindak = await prisma.storeReturn.findUnique({
    where: { id },
    select: {
      storeId: true,
      status: true,
      salesmanId: true,
      store: { select: { termsType: true, salesmanId: true, salesman: { select: { name: true, email: true } } } },
      items: BARIS,
      warehouseReturn: { select: { status: true, items: BARIS } },
      followUps: {
        orderBy: { receivedAt: "asc" },
        select: {
          id: true,
          noNri: true,
          status: true,
          physicalAmount: true,
          receivedAt: true,
          warehouseUser: { select: { name: true, email: true } },
          items: {
            select: { itemId: true, variantSku: true, itemName: true, qtyClaim: true, qty: true, amount: true, condition: true },
          },
        },
      },
      charges: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          id: true,
          status: true,
          amount: true,
          bearer: true,
          settledAmount: true,
          checkStatus: true,
          checkNote: true,
          checkedAt: true,
          checkedById: true,
          bearerUserId: true,
          checkedBy: { select: { name: true, email: true } },
          bearerUser: { select: { name: true, email: true } },
        },
      },
    },
  });
  const beban = tindak?.charges[0] ?? null;
  // Selisih yang masih bisa menerima barang susulan (P87, bawaan tercatat: tidak sesudah ada yang dibayar).
  const bisaSusulan = Boolean(
    beban &&
      Number(beban.amount) > 0 &&
      beban.status !== "LUNAS" &&
      Number(beban.settledAmount) === 0 &&
      tindak?.status !== "BATAL",
  );
  const tanganSusulan = new Map<string, string[]>();
  if (tindak && beban && bisaSusulan) {
    tanganSusulan.set(
      id,
      [tindak.salesmanId, beban.checkedById, beban.bearerUserId, tindak.store.salesmanId].filter((x): x is string => Boolean(x)),
    );
  }

  // Hitungan gudang buta, juga di rincian: orang yang akan menghitung nota ini
  // tidak menerima klaim, foto nota, rincian barang, atau potongannya sampai
  // hitungannya tersimpan — dan selama selisihnya masih menunggu barang
  // susulan, penghitung susulannya tidak menerima klaim, selisih, barang yang
  // kurang, atau catatan cek sales. Dibuang di server, bukan disembunyikan di layar.
  const lingkup = { bolehMenghitung, penggunaId, bolehMemutuskan: putusBeban, tanganSusulan };
  const butaCek = klaimDisembunyikan(data.baris, lingkup);
  const butaSelisih = !butaCek && selisihDisembunyikan(data.baris, lingkup);
  const buta = butaCek || butaSelisih;

  const [pengganti, asal, koreksi, riwayat, barang, barisBuku] = await Promise.all([
    penggantiUntuk("retur", [id]),
    prisma.storeReturn
      .findUnique({ where: { id }, select: { replacesReturnId: true } })
      .then((n) =>
        n?.replacesReturnId
          ? prisma.storeReturn.findUnique({ where: { id: n.replacesReturnId }, select: { id: true, noNrt: true } })
          : null,
      ),
    koreksiTertunda("retur", [id]),
    // Nota, hitungan gudangnya, dan hitungan susulannya: pemindahan toko tercatat di semuanya.
    riwayatDokumen([id, ...(data.gudang ? [data.gudang.id] : []), ...(tindak?.followUps.map((f) => f.id) ?? [])]),
    // Baris per varian + kondisi (nota SPG), dibaca di sini karena rinciannya
    // menyandingkan per nama saja.
    prisma.storeReturn.findUnique({
      where: { id },
      select: {
        reportedBySpg: true,
        items: { select: { itemId: true, variantSku: true, itemName: true, qty: true, amount: true, condition: true } },
        warehouseReturn: {
          select: {
            items: { select: { itemId: true, variantSku: true, itemName: true, qtyClaim: true, qty: true, amount: true, condition: true } },
          },
        },
      },
    }),
    // Nota yang sudah menggerakkan buku stok toko tidak bisa dipindah toko.
    prisma.storeStockMovement.count({ where: { refType: "StoreReturn", refId: id } }),
  ]);

  const susulanFinal = (tindak?.followUps ?? []).filter((f) => f.status === "FINAL");
  const rincianBarang: RincianBarangRetur | null = barang
    ? {
        dariSpg: barang.reportedBySpg,
        adaBukuToko: barisBuku > 0,
        klaim: buta ? [] : barang.items.map((i) => ({ ...i, amount: Number(i.amount) })),
        // Hitungan asli DITAMBAH barang susulan: yang diterima gudang seluruhnya. Qty klaim yang
        // disalin ke baris hitungan juga membocorkan klaim, jadi dikosongkan untuk penonton buta.
        fisik: [...(barang.warehouseReturn?.items ?? []), ...susulanFinal.flatMap((f) => f.items)].map((i) => ({
          ...i,
          qtyClaim: buta ? 0 : i.qtyClaim,
          amount: Number(i.amount),
        })),
      }
    : null;

  let tindakLanjut: TindakLanjutSelisih | null = null;
  if (tindak && beban && !buta) {
    const [holderSaatRetur, spg, tokoDiNota, calonYatim] = await Promise.all([
      pemegangSaatRetur(prisma, id).catch(() => null),
      prisma.user.findMany({ where: { assignedStoreId: tindak.storeId }, select: { name: true, email: true } }),
      beban.bearer === "TOKO" && beban.status !== "TERBUKA" ? bebanTokoDiNota(prisma, id) : Promise.resolve(null),
      // Penerimaan gudang tanpa nota di toko ini (atau tanpa toko) yang bisa jadi barang susulannya.
      kelola && bisaSusulan
        ? prisma.warehouseReturn.findMany({
            where: {
              storeReturnId: null,
              followUpOfStoreReturnId: null,
              status: "FINAL",
              OR: [{ storeId: tindak.storeId }, { storeId: null }],
            },
            orderBy: { receivedAt: "desc" },
            take: 50,
            select: { id: true, noNri: true, receivedAt: true, physicalAmount: true },
          })
        : Promise.resolve([]),
    ]);
    const holderNama = holderSaatRetur
      ? nama(await prisma.user.findUnique({ where: { id: holderSaatRetur }, select: { name: true, email: true } }))
      : null;
    const hitungan = [
      ...(tindak.warehouseReturn?.status === "FINAL" ? tindak.warehouseReturn.items : []),
      ...susulanFinal.flatMap((f) => f.items),
    ];
    tindakLanjut = {
      chargeId: beban.id,
      status: beban.status,
      bearer: beban.bearer,
      cek: beban.checkStatus as CekSelisih,
      cekCatatan: beban.checkNote,
      cekOleh: nama(beban.checkedBy),
      cekPada: beban.checkedAt ? beban.checkedAt.toISOString() : null,
      pemegangSekarang: nama(tindak.store.salesman),
      pemegangSaatRetur: holderSaatRetur && holderNama ? { id: holderSaatRetur, nama: holderNama } : null,
      spgToko: spg.map((u) => u.name ?? u.email),
      tokoKonsi: tindak.store.termsType === "KONSI",
      kurang: kurangPerBarang(tindak.items, hitungan)
        .filter((x) => x.qtyKurang > 0)
        .map((x) => ({ itemName: x.itemName, variantSku: x.variantSku || null, qtyKurang: x.qtyKurang })),
      susulan: susulanFinal.map((f) => ({
        id: f.id,
        noNri: f.noNri,
        tanggal: f.receivedAt.toISOString(),
        nilai: Number(f.physicalAmount),
        oleh: nama(f.warehouseUser),
      })),
      bisaSusulan,
      sudahDipotong: Number(beban.settledAmount),
      penanggungNama: nama(beban.bearerUser),
      tokoDiNota: tokoDiNota ? { tertahan: tokoDiNota.tertahan, tampil: tokoDiNota.tampil } : null,
      calonYatim: calonYatim.map((n) => ({
        id: n.id,
        noNri: n.noNri,
        tanggal: n.receivedAt.toISOString(),
        nilai: Number(n.physicalAmount),
      })),
    };
  }
  const k = koreksi.get(id);

  return (
    <RincianReturClient
      data={
        buta
          ? {
              ...data,
              baris: {
                ...data.baris,
                nilaiKlaim: null,
                nilaiDipotong: 0,
                jumlahPotongan: 0,
                ...(butaSelisih ? { selisih: 0 } : {}),
              },
              // Catatan nota toko sering menyebut jumlahnya ("3 dus"); layar
              // gudang pun tidak mengirimnya.
              note: null,
              photoUrl: null,
              barangKlaim: [],
              barangFisik: data.barangFisik.map((i) => ({ ...i, qtyClaim: 0 })),
              potongan: [],
              // Besar selisihnya juga membocorkan klaim selama susulannya menunggu dihitung.
              beban: butaSelisih ? null : data.beban,
            }
          : data
      }
      klaimTersembunyi={buta}
      selisihTersembunyi={butaSelisih}
      kandidat={kandidat}
      bolehMengelola={kelola}
      bolehPutuskanBeban={putusBeban}
      bolehMenghitung={bolehMenghitung}
      tokoTujuan={tokoTujuan}
      digantiOleh={pengganti.get(id) ?? null}
      menggantikan={asal ? { id: asal.id, nomor: asal.noNrt } : null}
      koreksi={k ? { pada: formatDisplayDate(k.pada), alasan: k.alasan } : null}
      riwayat={riwayat}
      rincianBarang={rincianBarang}
      tindakLanjut={tindakLanjut}
    />
  );
}
