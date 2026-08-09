"use client";

import { signOut } from "next-auth/react";

export function PackerSignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="text-xs text-slate-500 underline-offset-2 hover:underline"
    >
      Keluar
    </button>
  );
}
