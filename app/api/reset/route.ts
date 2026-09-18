import { NextResponse } from "next/server";
import { resetDb } from "@/lib/db";
import { stopContinuous, getSnapshot } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  stopContinuous("Paper bank reset.");
  resetDb();
  const snapshot = await getSnapshot();
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
