import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hitungLencanaMenu } from "@/lib/nav/lencana-menu";

export const dynamic = "force-dynamic";

/**
 * Badge counts for the sidebar — "where is work piling up", answered without
 * opening every menu.
 *
 * Deliberately a client-fetched route rather than data threaded through the
 * layout: the shell renders on every backoffice navigation, and blocking each
 * one on a dozen COUNT queries would trade a real cost for a decoration.
 *
 * The logic lives in `lib/nav/lencana-menu.ts` (testable without next-auth):
 * the SAME rows and permission gates as Beranda's action list, split per nav
 * group and per page. `counts` = per group, `pages` = per page — two maps,
 * because some parents share their href with one of their own children.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { grup, halaman } = await hitungLencanaMenu(session.user.permissions ?? [], session.user.id ?? null);
    return NextResponse.json({ counts: grup, pages: halaman });
  } catch (err) {
    // A failed badge fetch must never break the shell around it.
    console.error("nav-counts failed:", err);
    return NextResponse.json({ counts: {}, pages: {} });
  }
}
