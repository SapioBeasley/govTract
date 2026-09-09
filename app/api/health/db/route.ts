import { NextResponse } from "next/server";
import { checkDatabase } from "@/lib/db/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await checkDatabase();

    return NextResponse.json(
      {
        status: result.status,
        database: "connected",
        latencyMs: result.latencyMs,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Database health check failed", error);

    return NextResponse.json(
      {
        status: "error",
        database: "unavailable",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
