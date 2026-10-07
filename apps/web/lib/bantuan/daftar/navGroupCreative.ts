import type { EntriBantuan } from "../jenis";

export const ENTRI: EntriBantuan[] = [
  {
    rute: "/backoffice/kreatif/konten",
    bagian: "navGroupCreative",
    judul: { kunci: "creative.contentTitle" },
    isi: [
      { kunci: "creative.contentDescription" },
      "Tampilan Grid feed meniru feed Instagram: urutannya berasal dari jadwal tayang, gambar diunggah langsung ke ubinnya, dan menyeret satu ubin ke ubin lain menukar jadwal keduanya. Tampilan Daftar memuat semua konten dengan statusnya.",
      "Tampilan dan saringan status tersimpan di alamat halaman (?tampilan=, ?status=), jadi tetap sama saat kembali ke halaman ini.",
      "Ubin yang gambarnya gagal dimuat (mis. fotonya sudah terhapus) tampil sebagai slot kosong bertuliskan judulnya dan \"Gambar hilang — unggah ulang\"; klik atau seret gambar ke ubin itu untuk menggantinya.",
    ],
    kartu: [{ judul: { kunci: "creative.kpiFeeCommitted" }, isi: { kunci: "creative.kpiFeeCommittedHint" } }],
  },
  {
    rute: "/backoffice/kreatif/brief",
    bagian: "navGroupCreative",
    judul: { kunci: "creative.briefTitle" },
    isi: [
      { kunci: "creative.briefDescription" },
      "Brief baru tersimpan sebagai draf dan masih boleh diubah. Barang yang dicantumkan baru keluar dari gudang saat brief dikirim, dan tidak kembali ke stok bila brief itu dibatalkan sesudahnya.",
    ],
  },
  {
    rute: "/backoffice/kreatif/kol",
    bagian: "navGroupCreative",
    judul: { kunci: "creative.kolTitle" },
    isi: [{ kunci: "creative.kolDescription" }, { kunci: "creative.newKolHint" }],
  },
];
