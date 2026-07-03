import { auth } from "@/lib/auth";
import { computePostLoginRedirect } from "@/lib/auth/post-login-redirect";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const destination = session
    ? computePostLoginRedirect(session.user.permissions ?? [])
    : "/login";
  return new Response(null, {
    status: 307,
    headers: { Location: destination },
  });
}
