import { NextResponse } from "next/server";
import { startContinuous, stopContinuous, getSnapshot } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { enabled?: boolean };
  if (body.enabled) startContinuous();
  else stopContinuous();
  const snapshot = await getSnapshot();
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
