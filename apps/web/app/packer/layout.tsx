import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { packerAccessGuard } from "@/lib/packer/guard";
import { PackerSignOutButton } from "./PackerSignOutButton";

export const metadata = {
  title: "Record Packer — Elorae",
};

export default async function PackerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/packer");
  const outcome = packerAccessGuard(session.user.permissions);
  if (outcome === "redirect-backoffice") redirect("/backoffice");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Elorae
            </p>
            <h1 className="text-lg font-semibold leading-tight">Record Packer</h1>
          </div>
          <div className="text-right text-sm text-slate-600">
            <div className="font-medium">{session.user.name ?? session.user.email}</div>
            <PackerSignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
