import { NextResponse } from "next/server";
import { getPromptRegistry } from "@/lib/promptRegistry";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getPromptRegistry());
}
