"use client"

import { useEffect, useRef } from "react"
import { toast, useSonner } from "sonner"
import { idPerluDilepas, teruskanToast, type ToastMirip } from "@/lib/pulau/jembatan-toast"
import { ambilKeadaan, langgan } from "@/lib/pulau/pulau"

/**
 * Jembatan toast → pulau status.
 *
 * Semua pemanggil `toast.success/error/info/warning/loading/promise/message`
 * dari "sonner" tetap seperti apa adanya; komponen ini membaca toast aktif
 * lewat `useSonner()` dan meneruskannya ke pulau status di tengah atas.
 * Tumpukan bawaan sonner (komponen `Toaster` milik sonner) TIDAK lagi dipasang —
 * tes penjaga `lib/pulau/pemasangan.penjaga.test.ts` memastikannya.
 *
 * Saat pulau menutup sebuah pesan (waktunya habis atau diketuk), toast-nya
 * juga di-dismiss di sonner supaya daftar aktifnya tidak menumpuk sepanjang sesi.
 */
function Toaster() {
  const { toasts } = useSonner()
  const dikenal = useRef(new Map<string | number, ToastMirip>())
  const sudahDilepas = useRef(new Set<string | number>())

  useEffect(() => {
    dikenal.current = teruskanToast(dikenal.current, toasts)
    // Id yang muncul lagi (toast diperbarui sesudah ditutup) boleh dilepas lagi nanti.
    for (const id of sudahDilepas.current) if (!dikenal.current.has(id)) sudahDilepas.current.delete(id)
  }, [toasts])

  useEffect(
    () =>
      langgan(() => {
        for (const id of idPerluDilepas(dikenal.current.keys(), ambilKeadaan().pesan, sudahDilepas.current)) {
          sudahDilepas.current.add(id)
          toast.dismiss(id)
        }
      }),
    [],
  )

  return null
}

export { Toaster }
