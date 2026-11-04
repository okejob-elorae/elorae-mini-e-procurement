"use client";

/**
 * Galat di tata letak akar sendiri (penyedia sesi, tema, atau bahasa gagal).
 *
 * Halaman ini MENGGANTIKAN tata letak akar, jadi: wajib membawa <html><body>
 * sendiri, tidak ada penyedia i18n (teks Indonesia tetap), dan globals.css
 * tidak dijamin termuat (gaya sebaris). Tema mengikuti pilihan di perangkat ini
 * (`localStorage.theme`, kunci next-themes — sama dengan skrip tema awal),
 * lalu tema sistem. Pesan galat server tidak pernah ditampilkan; yang boleh
 * dilaporkan hanya kodenya (`digest`).
 */
import { useEffect, useSyncExternalStore } from "react";

type Props = { error: Error & { digest?: string }; reset: () => void };

function temaTersimpan(): "gelap" | "terang" | null {
  try {
    const t = window.localStorage.getItem("theme");
    return t === "dark" ? "gelap" : t === "light" ? "terang" : null;
  } catch {
    return null;
  }
}

const tanpaLangganan = () => () => {};
const temaServer = () => null;

const TERANG = "--latar:#f8fafc;--kartu:#ffffff;--teks:#0f172a;--redup:#475569;--garis:#e2e8f0;--utama:#0f172a;--utama-teks:#f8fafc";
const GELAP = "--latar:#0b1120;--kartu:#111827;--teks:#e5e7eb;--redup:#9ca3af;--garis:#374151;--utama:#e5e7eb;--utama-teks:#0b1120";

const GAYA = `
:root{color-scheme:light;${TERANG}}
@media (prefers-color-scheme: dark){:root:not([data-tema="terang"]){color-scheme:dark;${GELAP}}}
:root[data-tema="gelap"]{color-scheme:dark;${GELAP}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--latar);color:var(--teks);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.galat{width:100%;max-width:420px;background:var(--kartu);border:1px solid var(--garis);border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:16px;text-align:center}
.galat h1{font-size:1.125rem;line-height:1.4;margin:0}
.galat p{margin:0;color:var(--redup);font-size:.875rem;line-height:1.5}
.galat .tombol{min-height:44px;width:100%;border-radius:10px;font:inherit;font-size:.9375rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0 16px;text-decoration:none}
.galat .utama{background:var(--utama);color:var(--utama-teks);border:0}
.galat .kedua{background:transparent;color:var(--teks);border:1px solid var(--garis)}
.galat .tombol:focus-visible{outline:2px solid var(--teks);outline-offset:2px}
.galat .kode{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.75rem;user-select:all;word-break:break-all}
`;

export default function GlobalError({ error }: Props) {
  const tema = useSyncExternalStore(tanpaLangganan, temaTersimpan, temaServer);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="id" data-tema={tema ?? undefined}>
      <head>
        <title>Terjadi kesalahan · Elorae</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{GAYA}</style>
      </head>
      <body>
        <main className="galat" role="alert">
          <h1>Aplikasi gagal dimuat</h1>
          <p>Terjadi kesalahan. Coba lagi sebentar lagi.</p>
          {/* Muat ulang penuh, bukan reset(): galat tata letak akar dari server tidak pulih
              tanpa mengambil ulang halamannya. */}
          <button type="button" className="tombol utama" onClick={() => window.location.reload()}>
            Coba lagi
          </button>
          {/* Muat penuh, bukan navigasi klien: tata letak akarnya yang rusak. /login/redirect
              memilih beranda menurut izin (salesman/SPG → /pwa); "/" selalu ke kantor. */}
          <a className="tombol kedua" href="/login/redirect">
            Kembali ke beranda
          </a>
          {error.digest ? (
            <p>
              Bila masih gagal, laporkan kode ini ke admin: <span className="kode">{error.digest}</span>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
