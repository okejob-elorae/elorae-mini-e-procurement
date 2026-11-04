/**
 * Pembaca barcode dari gambar kamera — untuk HP apa pun.
 *
 * Browser yang punya `BarcodeDetector` bawaan (Chrome di Android dan Mac)
 * memakainya: cepat dan tanpa unduhan. Yang tidak punya (Safari di iPhone dan
 * Mac, Firefox, Chrome di Windows) memakai cadangan: pustaka
 * `barcode-detector`, yang membungkus ZXing (WASM) dengan API yang SAMA —
 * pemanggil tidak perlu tahu mana yang sedang dipakai.
 *
 * WASM cadangan (~1 MB) disajikan dari server sendiri
 * (`public/vendor/zxing-wasm-<versi>/`), bukan dari CDN bawaan pustaka: tidak
 * ada permintaan ke pihak ketiga setiap SPG membuka kamera, dan sekali termuat
 * ia tersimpan di cache browser. Diunduh hanya saat kamera pertama kali dibuka
 * di browser tanpa pembaca bawaan — SPG yang memakai alat pemindai tidak
 * pernah mengunduhnya.
 */

export type HasilDeteksi = { rawValue: string };
export type Detektor = { detect: (sumber: HTMLVideoElement) => Promise<HasilDeteksi[]> };
export type KelasDetektor = {
  new (opsi?: { formats?: string[] }): Detektor;
  getSupportedFormats?: () => Promise<string[]>;
};

/** Label barang memakai kode batang 1D; QR tetap dibaca untuk label masa depan. */
export const FORMAT_BARCODE = [
  "ean_13",
  "ean_8",
  "code_128",
  "code_39",
  "code_93",
  "upc_a",
  "upc_e",
  "itf",
  "codabar",
  "qr_code",
] as const;

export function jalurWasmZxing(versi: string): string {
  return `/vendor/zxing-wasm-${versi}/zxing_reader.wasm`;
}

/**
 * Format kita yang bisa dibaca pembaca bawaan. Kosong berarti bawaan tidak
 * bisa diandalkan — mis. Chrome Android tanpa layanan Google, yang punya
 * kelasnya tapi tidak mendukung satu format pun.
 */
export async function formatBawaan(kelas: KelasDetektor | null): Promise<string[]> {
  if (!kelas) return [];
  try {
    const didukung = kelas.getSupportedFormats ? await kelas.getSupportedFormats() : [...FORMAT_BARCODE];
    return FORMAT_BARCODE.filter((f) => didukung.includes(f));
  } catch {
    return [];
  }
}

function kelasBawaan(): KelasDetektor | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: KelasDetektor }).BarcodeDetector ?? null;
}

async function buatDetektor(): Promise<Detektor> {
  const Bawaan = kelasBawaan();
  const format = await formatBawaan(Bawaan);
  if (Bawaan && format.length > 0) return new Bawaan({ formats: format });

  const { BarcodeDetector, prepareZXingModule, ZXING_WASM_VERSION } = await import("barcode-detector/ponyfill");
  // Dimuat SEKARANG, bukan pada deteksi pertama: berkas yang gagal diunduh
  // harus jadi pesan yang terlihat, bukan kamera yang diam-diam tidak membaca.
  await prepareZXingModule({
    overrides: {
      locateFile: (berkas: string, awalan: string) => (berkas.endsWith(".wasm") ? jalurWasmZxing(ZXING_WASM_VERSION) : awalan + berkas),
    },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats: [...FORMAT_BARCODE] });
}

let siap: Promise<Detektor> | null = null;

/** Satu pembaca untuk seluruh halaman; yang gagal dimuat dicoba lagi saat berikutnya. */
export function siapkanDetektor(): Promise<Detektor> {
  if (!siap) {
    const janji = buatDetektor();
    siap = janji;
    janji.catch(() => {
      if (siap === janji) siap = null;
    });
  }
  return siap;
}
