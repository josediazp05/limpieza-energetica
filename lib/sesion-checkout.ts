import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { sendInitiateCheckout } from "@/lib/meta-capi";
import { createCheckoutSession, type CheckoutSession } from "@/lib/whop";
import { MAIN_PLAN_ID, PRODUCT } from "@/app/(funnel)/checkout/constants";
import { loadPricing, totalFor, type OrderPricing } from "@/app/(funnel)/checkout/pricing";

// Abrir la sesión de cobro, en un sitio al que llegan los dos que la necesitan:
// la página —que la abre ya en el servidor, para que el formulario no tenga que
// esperar a que hidrate el JS— y la ruta que la rehace cuando cambia el pedido.
//
// El total NO se toma del navegador: solo llegan ids de bumps y el importe se
// recalcula acá contra los planes de Whop.

export interface SesionDelPedido {
  session: CheckoutSession | null;
  pricing: OrderPricing;
  total: ReturnType<typeof totalFor>;
  /** Por qué falló, tal como lo contó Whop. Solo se enseña en desarrollo. */
  error?: string;
}

/** El origen https del sitio, que Whop exige para poder devolver al comprador. */
export async function httpsOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (host && proto === "https") return `https://${host}`;
  const fallback = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  return fallback?.startsWith("https") ? fallback : null;
}

function limpiar(metadata: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, v]) => v && v.trim())
  ) as Record<string, string>;
}

export async function abrirSesionDelPedido(
  bumpIds: string[],
  opciones: { fbclid?: string | null } = {}
): Promise<SesionDelPedido> {
  const [h, c, base] = await Promise.all([headers(), cookies(), httpsOrigin()]);

  const pricing = await loadPricing();
  const total = totalFor(pricing, bumpIds);

  const fbc = c.get("_fbc")?.value;
  const fbp = c.get("_fbp")?.value;
  const metaExternalId = c.get("meta_sid_v1")?.value;
  const clientIp =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
  const userAgent = h.get("user-agent") || undefined;
  // La venta entra en dólares siempre. Lo que el comprador ve en la suya lo
  // convierte Whop dentro del iframe, con su propia tasa.
  const moneda = "usd";

  const metadata = limpiar({
    fbc,
    fbp,
    fbclid: opciones.fbclid || (fbc ? fbc.split(".").at(-1) : undefined),
    meta_external_id: metaExternalId,
    client_ip: clientIp,
    user_agent: userAgent,
    source_url: base ?? undefined,
    // Qué se compró de verdad. La sesión solo cobra el producto, así que sin
    // esto no habría forma de saber qué order bump hay que entregar.
    main_plan_id: MAIN_PLAN_ID,
    bump_plan_ids: total.accepted.map((b) => b.planId).join(",") || undefined,
    bump_product_ids:
      total.accepted.map((b) => b.productId).filter(Boolean).join(",") || undefined,
    total_today: String(total.today),
    currency: moneda,
  });

  const { session, error } = await createCheckoutSession({
    // Siempre el plan de siempre, marque el comprador el bump o no: esta sesión
    // cobra el producto y nada más. El bump se cobra después, contra esa misma
    // tarjeta. Es lo que mantiene el plan en pago único, que es la condición
    // para que Whop convierta el precio a la moneda del comprador.
    planId: MAIN_PLAN_ID,
    ...(base ? { redirectUrl: `${base}${PRODUCT.returnPath}` } : {}),
    metadata,
  });

  if (session) {
    // Meta CAPI no debe estar en el camino crítico del checkout. El HTML ya
    // tiene la sesión de Whop; mandar el evento puede ocurrir justo después de
    // responder sin retrasar el montaje del iframe.
    after(() => {
      void sendInitiateCheckout({
        eventId: session.id,
        eventTime: new Date(),
        value: total.today,
        // La moneda tiene que ser la del importe: mandar pesos etiquetados como
        // dólares le rompe a Meta el valor de conversión y con él el ROAS.
        currency: moneda.toUpperCase(),
        fbc,
        fbp,
        externalId: metaExternalId,
        clientIp,
        clientUserAgent: userAgent,
        sourceUrl: base,
        contentIds: [MAIN_PLAN_ID, ...total.accepted.map((b) => b.planId)],
        contentName: PRODUCT.name,
      }).catch((error) => {
        console.error("[meta] no se pudo mandar InitiateCheckout", error);
      });
    });
  }

  return { session, pricing, total, error };
}

/**
 * La URL del iframe de Whop para una sesión.
 *
 * La página la emite como `prefetch` en el HTML: son 1,4 MB y 76 chunks, y sin
 * esto el navegador no empieza a bajarlos hasta que React hidrata y monta el
 * embed —casi dos segundos más tarde—. Con el prefetch bajan en paralelo con
 * el JS de la página, no detrás.
 */
export function urlDelEmbed(sessionId: string): string {
  return `https://whop.com/embedded/checkout/${sessionId}/`;
}
