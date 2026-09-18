import { NextResponse } from "next/server";
import { runAutopilotCycle } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const result = await runAutopilotCycle();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
