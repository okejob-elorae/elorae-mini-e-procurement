"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { deleteFcmToken } from "@/components/notifications/fcm-client";

export function PackerSignOutButton() {
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    await deleteFcmToken();
    await signOut({ callbackUrl: "/login" });
  };

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={signingOut}
      className="inline-flex items-center gap-1 text-xs text-white/80 underline-offset-2 hover:text-white hover:underline disabled:opacity-70"
    >
      {signingOut && <Loader2 className="h-3 w-3 animate-spin" />}
      Keluar
    </button>
  );
}
