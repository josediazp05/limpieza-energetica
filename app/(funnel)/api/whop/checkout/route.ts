import { NextRequest, NextResponse } from "next/server";
import { CHECKOUT_CONFIG_COOKIE, COOKIE_MAX_AGE } from "../constants";
import { sendInitiateCheckout } from "@/lib/meta-capi";
import { PASOS, esPaso, siteUrl } from "../../../funnel";

/**
 * El checkout hosteado de Whop.
 *
 * Se usa cuando el formulario propio no sirve: el one-click de un upsell que no
 * encuentra tarjeta guardada —quien pagó por PSE, Nequi o Pix no dejó ninguna—.
 * Ahí la oferta se cobra en whop.com, que acepta todos los métodos, y el
 * comprador vuelve al embudo por `next`.
 *
 * El id de la configuración queda en cookie: es como `/f/<paso>/si` encuentra
 * después el pago de ESTE visitante para cobrarle el paso siguiente.
 */

/**
 * A dónde puede volver el comprador, en lista cerrada.
 *
 * `redirect_url` sale de la URL de esta ruta, así que sin acotarlo cualquiera
 * podría usar el endpoint para mandar gente a su sitio con el checkout de Whop
 * de por medio.
 */
function retorno(valor: string | null, porDefecto: string): string {
  if (!valor) return porDefecto;
  if (valor === "/checkout") return valor;
  const m = /^\/f\/([a-z0-9]+)\/(si|no|hecho)$/.exec(valor);
  if (m && esPaso(m[1])) return valor;
  return porDefecto;
}

function primeraIp(request: NextRequest): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined
  );
}

function limpiar(metadata: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, v]) => v && v.trim())
  );
}

/** El valor anunciado del plan, para que el evento de Meta no vaya sin importe. */
function valorDelPlan(planId: string): number | undefined {
  return Object.values(PASOS).find((p) => p.planId === planId)?.valor;
}

export async function GET(request: NextRequest) {
  const planId =
    request.nextUrl.searchParams.get("plan_id") || PASOS.checkout.planId || "";
  const destino = retorno(request.nextUrl.searchParams.get("next"), "/f/checkout/hecho");
  const caida = retorno(request.nextUrl.searchParams.get("fallback"), "/checkout");
  const origin = request.nextUrl.origin;

  if (!planId) {
    console.error("[whop] checkout hosteado sin plan: falta WHOP_PLAN_MAIN");
    return NextResponse.redirect(new URL(caida, origin));
  }

  // Whop exige https en `redirect_url`; en local hay que poner el dominio real
  // en NEXT_PUBLIC_SITE_URL.
  const base = origin.startsWith("https") ? origin : siteUrl();
  if (!base) {
    console.error("[whop] falta NEXT_PUBLIC_SITE_URL para el checkout fuera de https");
    return NextResponse.redirect(new URL(caida, origin));
  }

  const fbc = request.cookies.get("_fbc")?.value;
  const fbp = request.cookies.get("_fbp")?.value;
  const metaExternalId = request.cookies.get("meta_sid_v1")?.value;
  const fbclid =
    request.nextUrl.searchParams.get("fbclid") || (fbc ? fbc.split(".").at(-1) : undefined);
  const clientIp = primeraIp(request);
  const userAgent = request.headers.get("user-agent") || undefined;
  const metadata = limpiar({
    fbc,
    fbp,
    fbclid: fbclid || undefined,
    meta_external_id: metaExternalId,
    client_ip: clientIp,
    user_agent: userAgent,
    source_url: base,
    plan_id: planId,
  });

  try {
    const response = await fetch("https://api.whop.com/api/v1/checkout_configurations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHOP_API_KEY}`,
        "Content-Type": "application/json",
      },
      // La API key ya está scoped a la company: mandar company_id da 400
      // ("Cannot provide company_id for this configuration").
      body: JSON.stringify({
        plan_id: planId,
        mode: "payment",
        redirect_url: `${base}${destino}`,
        ...(Object.keys(metadata).length ? { metadata } : {}),
      }),
    });

    if (!response.ok) {
      console.error("[whop] no se pudo crear la configuración:", await response.text());
      return NextResponse.redirect(new URL(caida, origin));
    }

    const config: { id: string; purchase_url: string | null } = await response.json();

    if (!config.purchase_url) {
      console.error("[whop] configuración sin purchase_url:", config.id);
      return NextResponse.redirect(new URL(caida, origin));
    }

    await sendInitiateCheckout({
      eventId: config.id,
      eventTime: new Date(),
      value: valorDelPlan(planId),
      currency: valorDelPlan(planId) ? "EUR" : undefined,
      fbc,
      fbp,
      externalId: metaExternalId,
      clientIp,
      clientUserAgent: userAgent,
      sourceUrl: base,
      contentIds: [planId],
      contentName: PASOS.checkout.nombre,
    });

    // La API puede devolver purchase_url relativo (/checkout/plan_x?session=y).
    const purchaseUrl = new URL(config.purchase_url, "https://whop.com");
    const redirect = NextResponse.redirect(purchaseUrl);

    // Solo la compra del producto principal deja cookie: es el pago cuya
    // tarjeta cobran después los upsells. Si un upsell la pisara al caer acá,
    // el paso siguiente buscaría el pago del visitante en una configuración
    // que quizá nadie llegó a pagar, y perdería el one-click que sí tenía.
    if (planId === PASOS.checkout.planId) {
      redirect.cookies.set(CHECKOUT_CONFIG_COOKIE, config.id, {
        httpOnly: true,
        secure: origin.startsWith("https"),
        sameSite: "lax",
        path: "/",
        maxAge: COOKIE_MAX_AGE,
      });
    }
    return redirect;
  } catch (error) {
    console.error("[whop] error creando la configuración:", error);
    return NextResponse.redirect(new URL(caida, origin));
  }
}
