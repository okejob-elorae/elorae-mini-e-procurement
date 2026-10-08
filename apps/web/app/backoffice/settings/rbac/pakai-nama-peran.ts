"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { namaTampilPeran } from "./nama-peran";

/** `namaTampilPeran` dengan terjemahan bahasa aktif — dipakai Pengguna dan Peran & izin. */
export function useNamaPeran(): (nama: string) => string {
  const t = useTranslations("settings.users.roleName");
  return useCallback((nama: string) => namaTampilPeran(nama, (kode) => t(kode)), [t]);
}
