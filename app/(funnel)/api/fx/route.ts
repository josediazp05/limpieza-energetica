import { NextRequest, NextResponse } from "next/server";
import { buyerDisplayFx, usdFxForCurrency } from "@/lib/fx";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedCurrency = request.nextUrl.searchParams.get("currency")?.toUpperCase();
  const fx = requestedCurrency && /^[A-Z]{3}$/.test(requestedCurrency)
    ? await usdFxForCurrency(requestedCurrency)
    : await buyerDisplayFx();

  return NextResponse.json(fx);
}
