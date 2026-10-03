import { auth } from "@/lib/auth";
import { computePostLoginRedirect } from "@/lib/auth/post-login-redirect";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  // Halaman yang tadi meminta masuk; diperiksa ketat di computePostLoginRedirect.
  const callbackUrl = new URL(request.url).searchParams.get("callbackUrl");
  const destination = session
    ? computePostLoginRedirect(session.user.permissions ?? [], callbackUrl)
    : "/login";
  return new Response(null, {
    status: 307,
    headers: { Location: destination },
  });
}
