import { NextResponse } from "next/server";
import { getDbReadout } from "@/lib/dbReadout";

export const dynamic = "force-dynamic";

export async function GET() {
  const readout = await getDbReadout();
  return NextResponse.json(readout);
}
