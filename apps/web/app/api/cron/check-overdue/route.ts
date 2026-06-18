// Automated firing is handled by the in-process node-cron registered in instrumentation.ts.
// This route remains available as a manual trigger (e.g. smoke testing).
import { NextRequest, NextResponse } from "next/server";
import { runCheckOverdue } from "@/lib/cron/check-overdue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await runCheckOverdue();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Cron check-overdue failed:", err);
    return NextResponse.json(
      { error: "Internal error", message: err instanceof Error ? err.message : "Unknown" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
