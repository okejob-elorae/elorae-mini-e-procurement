import { auth } from "@/lib/auth";
import { computePostLoginRedirect } from "@/lib/auth/post-login-redirect";

export const dynamic = "force-dynamic";

/** Cookie sesi Auth.js (beserta potongannya `.0`, `.1`, … bila token besar). */
const COOKIE_SESI = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;

/**
 * Cookie sesi yang masih dibawa peramban padahal sesinya sudah tidak sah
 * (akun dihapus — lib/auth/segarkan-sesi.ts). `auth()` di sini tidak bisa
 * menghapusnya, dan proxy.ts membaca cookie itu langsung, jadi tanpa ini
 * /login → /login/redirect → /login berputar tanpa akhir.
 */
function hapusCookieSesi(request: Request): string[] {
  const nama = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.split("=")[0]?.trim() ?? "")
    .filter((n) => COOKIE_SESI.test(n));
  return [...new Set(nama)].map(
    (n) => `${n}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${n.startsWith("__Secure-") ? "; Secure" : ""}`,
  );
}

export async function GET(request: Request) {
  const session = await auth();
  // Halaman yang tadi meminta masuk; diperiksa ketat di computePostLoginRedirect.
  const callbackUrl = new URL(request.url).searchParams.get("callbackUrl");
  const destination = session
    ? computePostLoginRedirect(session.user.permissions ?? [], callbackUrl)
    : "/login";
  const headers = new Headers({ Location: destination });
  if (!session) for (const c of hapusCookieSesi(request)) headers.append("Set-Cookie", c);
  return new Response(null, { status: 307, headers });
}
