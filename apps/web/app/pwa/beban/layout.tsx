import { MenuBawahPiutang } from "../MenuBawahPiutang";

/**
 * Menu bawah dipasang lewat layout tiap rute, bukan di layout `/pwa` induk:
 * rute PWA lain (katalog, van, kunjungan) punya menunya sendiri, dan menaruhnya
 * di induk akan menempelkan menu piutang ke layar yang bukan miliknya.
 */
export default function LayoutPiutangLapangan({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <MenuBawahPiutang />
    </div>
  );
}
