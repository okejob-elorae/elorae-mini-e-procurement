import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { computePostLoginRedirect } from "@/lib/auth/post-login-redirect";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const destination = computePostLoginRedirect(session.user.permissions ?? []);
  return NextResponse.redirect(new URL(destination, request.url));
}
