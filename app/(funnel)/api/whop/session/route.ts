import { NextRequest, NextResponse } from "next/server";
import { CHECKOUT_CONFIG_COOKIE, COOKIE_MAX_AGE } from "../constants";
import { abrirSesionDelPedido } from "@/lib/sesion-checkout";
import { MAIN_PLAN_ID } from "../../../checkout/constants";

export const dynamic = "force-dynamic";

/**
 * Rehace la sesión cuando cambia el pedido.
 *
 * La primera ya viene abierta desde la página —ver `lib/sesion-checkout.ts`—,
 * así que acá solo se llega cuando el comprador mueve un order bump y el
 * importe deja de ser el que se cotizó al cargar.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const bumpIds = (Array.isArray(body.bumpIds) ? body.bumpIds : [])
    .filter((v: unknown): v is string => typeof v === "string")
    .slice(0, 20);

  const { session, total, error } = await abrirSesionDelPedido(bumpIds, {
    fbclid: request.nextUrl.searchParams.get("fbclid"),
  });

  if (!session) {
    // Si Whop falla no perdemos la venta: el embed monta con el plan principal
    // a pelo, sin sesión ni API key. Lo que se pierde es la metadata de
    // atribución, no el importe.
    //
    // El motivo real del fallo se apunta solo en desarrollo: en producción esto
    // lo lee un comprador, y un volcado de Whop no le dice nada.
    if (error && process.env.NODE_ENV === "development") {
      console.error("[checkout] sesión no abierta, cayendo al plan suelto:", error);
    }
    return NextResponse.json({ sessionId: null, fallbackPlanId: MAIN_PLAN_ID });
  }

  const response = NextResponse.json({
    sessionId: session.id,
    planId: session.planId,
    purchaseUrl: session.purchaseUrl,
    today: total.today,
  });

  // La misma cookie del checkout hosteado: es como `/f/<paso>/si` encuentra el
  // pago de ESTE visitante para cobrarle el upsell de un clic.
  response.cookies.set(CHECKOUT_CONFIG_COOKIE, session.id, {
    httpOnly: true,
    secure: request.nextUrl.origin.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}
