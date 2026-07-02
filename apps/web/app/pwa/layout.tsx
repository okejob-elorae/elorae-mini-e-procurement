import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ServiceWorkerRegistrar } from "./ServiceWorkerRegistrar";

export const metadata = {
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#334155",
};

export default async function PwaLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/pwa");
  const perms = (session.user as { permissions?: string[] } | undefined)?.permissions;
  const outcome = pwaAccessGuard(perms);
  if (outcome === "redirect-backoffice") redirect("/backoffice");
  return (
    <>
      <ServiceWorkerRegistrar />
      {children}
    </>
  );
}
