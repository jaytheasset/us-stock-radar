import { NextResponse } from "next/server";
import { BrokeragePolicyError } from "./serverRepository";

export const BROKERAGE_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

export function brokerageErrorResponse(error: unknown) {
  if (error instanceof BrokeragePolicyError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: BROKERAGE_PRIVATE_HEADERS },
    );
  }
  return NextResponse.json(
    { error: "Brokerage data is temporarily unavailable.", code: "BROKERAGE_UNAVAILABLE" },
    { status: 500, headers: BROKERAGE_PRIVATE_HEADERS },
  );
}
