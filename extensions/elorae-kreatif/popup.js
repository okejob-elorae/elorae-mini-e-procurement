// Popup ekstensi: sambungkan ke Elorae, lihat keadaan, nyalakan/matikan pemantauan otomatis.
// Semua kerja sungguhan di service worker; popup hanya mengirim pesan dan menampilkan ringkasan.
import { waktuWib } from "./lib/aturan.js";
import { AKSEN, KUNCI_TAMPILAN, bersihkanTampilan, warnaAksen } from "./lib/tampilan.js";

const $ = (id) => document.getElementById(id);
const angka = new Intl.NumberFormat("id-ID");

function kirim(pesan) {
  return new Promise((selesai) => {
    chrome.runtime.sendMessage(pesan, (jawaban) => {
      if (chrome.runtime.lastError) selesai({ ok: false, pesan: chrome.runtime.lastError.message });
      else selesai(jawaban ?? { ok: false });
    });
  });
}

function tampilkanAngka(id, nilai) {
  $(id).textContent = typeof nilai === "number" ? angka.format(nilai) : "—";
}

function gambar(r) {
  $("versi").textContent = r?.versi ? `Versi ${r.versi}` : "";
  const tersambung = Boolean(r?.tersambung);
  $("bagianSambung").hidden = tersambung;
  $("bagianTersambung").hidden = !tersambung;

  if (!tersambung) {
    if (r?.eloraeUrl && !$("alamat").dataset.disentuh) $("alamat").value = r.eloraeUrl;
    const putus = r?.terputus;
    $("pesanTerputus").hidden = !putus;
    if (putus) {
      $("pesanTerputus").textContent =
        putus.alasan === "TOKEN_TIDAK_SAH"
          ? "Sambungan dicabut di Elorae. Buat kode sambung baru lalu sambungkan ulang."
          : "Sambungan terputus. Sambungkan ulang.";
    }
    return;
  }

  $("namaPerangkat").textContent = r.perangkat?.nama ?? "—";
  $("alamatElorae").textContent = r.eloraeUrl ?? "—";
  tampilkanAngka("hariSelesai", r.hariIni?.selesai);
  tampilkanAngka("hariGagal", r.hariIni?.gagal);
  tampilkanAngka("hariKuota", r.hariIni?.kuota);
  tampilkanAngka("hariSisa", r.hariIni?.sisa);
  $("otomatis").checked = Boolean(r.otomatis);
  $("keadaan").textContent = r.teksKeadaan ?? "—";

  const tampilBerikut = r.otomatis && Number.isFinite(r.berikutnyaAt) && r.berikutnyaAt > Date.now();
  $("berikutnya").textContent = tampilBerikut
    ? `${waktuWib(r.berikutnyaAt)} WIB`
    : r.otomatis && ["SIAP", "MENUNGGU"].includes(r.keadaan)
      ? "dalam ±1 menit"
      : "—";

  const galat = r.galatTerakhir;
  $("barisGalat").hidden = !galat;
  if (galat) $("galatTerakhir").textContent = `${galat.pesan} (${waktuWib(galat.at)})`;
}

async function segarkan(denganStatus) {
  gambar(await kirim({ jenis: "ringkasan", segarkan: denganStatus }));
}

$("alamat").addEventListener("input", () => {
  $("alamat").dataset.disentuh = "1";
});

$("formSambung").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const tombol = $("tombolSambung");
  const pesan = $("pesanSambung");
  pesan.textContent = "";
  if (!$("kode").value.trim()) {
    pesan.textContent = "Isi kode sambung dari Elorae.";
    $("kode").focus();
    return;
  }
  tombol.disabled = true;
  tombol.textContent = "Menyambungkan…";
  const r = await kirim({ jenis: "sambung", eloraeUrl: $("alamat").value, kode: $("kode").value });
  tombol.disabled = false;
  tombol.textContent = "Sambungkan";
  if (!r?.ok) {
    pesan.textContent = r?.pesan ?? "Gagal menyambungkan.";
    return;
  }
  $("kode").value = "";
  await segarkan(true);
});

$("otomatis").addEventListener("change", async (ev) => {
  await kirim({ jenis: "setelOtomatis", nyala: ev.target.checked });
  await segarkan(false);
});

let konfirmasiPutus = null;
$("tombolPutuskan").addEventListener("click", async () => {
  const tombol = $("tombolPutuskan");
  if (!konfirmasiPutus) {
    tombol.textContent = "Yakin? Tekan sekali lagi";
    konfirmasiPutus = setTimeout(() => {
      konfirmasiPutus = null;
      tombol.textContent = "Putuskan";
    }, 4000);
    return;
  }
  clearTimeout(konfirmasiPutus);
  konfirmasiPutus = null;
  tombol.textContent = "Putuskan";
  const hasil = await kirim({ jenis: "putuskan" });
  await segarkan(false);
  if (hasil?.ok && !hasil.dicabutDiElorae) {
    $("pesanTerputus").hidden = false;
    $("pesanTerputus").textContent =
      "Diputus di sini, tapi Elorae tidak terjangkau. Cabut perangkat ini dari Kreatif → Pemantauan.";
  }
});

// Ikuti perubahan dari service worker selama popup terbuka.
chrome.storage.onChanged.addListener((perubahan, area) => {
  if (area !== "local") return;
  if (["ringkasan", "statusServer", "koneksi", "otomatis", "galatTerakhir", "jadwal"].some((k) => k in perubahan)) {
    segarkan(false);
  }
});

segarkan(true);

// ------------------------------------------------------------ tampilan panel di TikTok
// Disimpan langsung di storage.local; panel yang sedang terbuka di TikTok ikut berubah seketika.
let tampilan = bersihkanTampilan(null);

async function simpanTampilan(sebagian) {
  tampilan = bersihkanTampilan({ ...tampilan, ...sebagian });
  await chrome.storage.local.set({ [KUNCI_TAMPILAN]: tampilan });
  gambarTampilan();
}

function gambarTampilan() {
  for (const grup of document.querySelectorAll(".segmen[data-kunci]")) {
    for (const b of grup.querySelectorAll("button")) b.setAttribute("aria-checked", String(tampilan[grup.dataset.kunci] === b.dataset.nilai));
  }
  for (const b of $("pilihWarna").querySelectorAll("button[data-aksen]")) b.setAttribute("aria-checked", String(tampilan.aksen === b.dataset.aksen));
  const sendiri = !(tampilan.aksen in AKSEN);
  $("warnaSendiri").setAttribute("aria-checked", String(sendiri));
  if (sendiri) $("warnaSendiri").querySelector("input").value = tampilan.aksen;
}

function siapkanTampilan() {
  for (const grup of document.querySelectorAll(".segmen[data-kunci]")) {
    grup.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-nilai]");
      if (b) simpanTampilan({ [grup.dataset.kunci]: b.dataset.nilai });
    });
  }
  const wadah = $("pilihWarna");
  for (const [kunci, { nama }] of Object.entries(AKSEN)) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.aksen = kunci;
    b.title = nama;
    b.setAttribute("aria-label", nama);
    b.style.setProperty("--contoh", warnaAksen(kunci, "gelap").aksen);
    b.addEventListener("click", () => simpanTampilan({ aksen: kunci }));
    wadah.append(b);
  }
  const lain = document.createElement("label");
  lain.id = "warnaSendiri";
  lain.className = "warna-sendiri";
  lain.title = "Pilih warna sendiri";
  lain.setAttribute("role", "radio");
  const masukan = document.createElement("input");
  masukan.type = "color";
  masukan.value = "#c9b8ff";
  masukan.setAttribute("aria-label", "Pilih warna sendiri");
  masukan.addEventListener("change", () => simpanTampilan({ aksen: masukan.value }));
  lain.append(masukan);
  wadah.append(lain);
}

siapkanTampilan();
chrome.storage.local.get(KUNCI_TAMPILAN).then((r) => {
  tampilan = bersihkanTampilan(r?.[KUNCI_TAMPILAN]);
  gambarTampilan();
});
