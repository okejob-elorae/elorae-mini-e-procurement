import { NextRequest, NextResponse } from "next/server";
import { runReconciliationCron } from "@/app/actions/stock-reconciliation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runReconciliationCron();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Cron reconciliation failed:", err);
    return NextResponse.json(
      { error: "Internal error", message: err instanceof Error ? err.message : "Unknown" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
