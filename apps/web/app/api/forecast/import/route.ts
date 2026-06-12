import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { SalesChannel } from "@elorae/db";
import { auth } from "@/lib/auth";
import { executeSalesHistoryImport } from "@/lib/forecast/import-sales-history";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);
const FORECAST_PATH = "/backoffice/forecast";
const FORECAST_IMPORT_PATH = "/backoffice/forecast/import";

function parseChannel(value: string | null): SalesChannel | null {
  if (value === "SHOPEE" || value === "TIKTOK") return value;
  return null;
}

function parsePeriodMonth(value: string | null): number | null {
  if (!value) return null;
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return month;
}

function parsePeriodYear(value: string | null): number | null {
  if (!value) return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return year;
}

function isXlsxFile(file: File): boolean {
  if (ALLOWED_TYPES.has(file.type)) return true;
  return file.name.toLowerCase().endsWith(".xlsx");
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    requirePermission(session.user.permissions, PERMISSIONS.FORECAST_MANAGE);

    const formData = await request.formData();
    const file = formData.get("file");
    const channel = parseChannel(formData.get("channel")?.toString() ?? null);
    const periodMonth = parsePeriodMonth(formData.get("periodMonth")?.toString() ?? null);
    const periodYear = parsePeriodYear(formData.get("periodYear")?.toString() ?? null);

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }
    if (!channel) {
      return NextResponse.json(
        { success: false, error: "Invalid channel" },
        { status: 400 }
      );
    }
    if (periodMonth == null) {
      return NextResponse.json(
        { success: false, error: "Invalid period month" },
        { status: 400 }
      );
    }
    if (periodYear == null) {
      return NextResponse.json(
        { success: false, error: "Invalid period year" },
        { status: 400 }
      );
    }
    if (!isXlsxFile(file)) {
      return NextResponse.json(
        { success: false, error: "File must be an .xlsx spreadsheet" },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: "File exceeds the 10 MB limit" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await executeSalesHistoryImport({
      buffer,
      fileName: file.name,
      channel,
      periodMonth,
      periodYear,
      userId: session.user.id,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    revalidatePath(FORECAST_PATH);
    revalidatePath(FORECAST_IMPORT_PATH);

    return NextResponse.json(result);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 403) {
      return NextResponse.json(
        { success: false, error: "Forbidden: Insufficient permissions" },
        { status: 403 }
      );
    }
    console.error("Forecast import error:", error);
    return NextResponse.json(
      { success: false, error: "Import failed" },
      { status: 500 }
    );
  }
}
