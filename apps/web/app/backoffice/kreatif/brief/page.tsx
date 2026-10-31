import { redirect } from "next/navigation";

/**
 * Layar Brief lama digantikan Kolaborasi (Ruang KOL, 2026-10-07). Alamat lama
 * tetap hidup supaya tautan dan markah yang tersimpan tidak berakhir di 404.
 */
export default function BriefPage() {
  redirect("/backoffice/kreatif/kolaborasi");
}
