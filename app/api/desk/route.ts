import { NextResponse } from "next/server";
import { ensureContinuousTimer, getSnapshot } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureContinuousTimer();
  const snapshot = await getSnapshot();
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
