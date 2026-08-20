"use client";

import { signOut } from "next-auth/react";

export function PackerSignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="text-xs text-white/80 underline-offset-2 hover:text-white hover:underline"
    >
      Keluar
    </button>
  );
}
