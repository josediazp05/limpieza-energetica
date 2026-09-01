// Lo que el checkout necesita de Whop: leer precios y abrir sesiones de cobro.
//
// Va por `fetch` contra la REST v1 y no por el SDK, igual que el resto de rutas
// del embudo, para que todas hablen con Whop de la misma forma.

const WHOP_API = "https://api.whop.com/api/v1";

function auth(): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.WHOP_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export interface WhopPlan {
  id: string;
  title: string | null;
  productId: string | null;
  productTitle: string | null;
  currency: string;
  planType: "one_time" | "renewal";
  /** Lo que se cobra hoy. */
  initialPrice: number;
  /** Lo que se cobra cada periodo. 0 en pago único. */
  renewalPrice: number;
  /** Días entre cobros. `null` en pago único. */
  billingPeriod: number | null;
}

/**
 * Los planes que lee el checkout no cambian de precio entre una visita y la
 * siguiente, así que se guardan un rato en memoria: sin esto, cada vez que
 * alguien marca un order bump se le pediría el precio a Whop otra vez.
 */
const planCache = new Map<string, { plan: WhopPlan; at: number }>();
const PLAN_TTL_MS = 5 * 60 * 1000;

/** El plan tal como está hoy en Whop, o `null` si no se pudo leer. */
export async function getPlan(planId: string): Promise<WhopPlan | null> {
  const hit = planCache.get(planId);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.plan;

  try {
    const res = await fetch(`${WHOP_API}/plans/${planId}`, { headers: auth() });
    if (!res.ok) {
      console.error(`[whop] no se pudo leer el plan ${planId}:`, await res.text());
      return null;
    }
    const raw = await res.json();
    const plan: WhopPlan = {
      id: raw.id,
      title: raw.title ?? null,
      productId: raw.product?.id ?? null,
      productTitle: raw.product?.title ?? null,
      currency: (raw.currency ?? "usd").toLowerCase(),
      planType: raw.plan_type === "renewal" ? "renewal" : "one_time",
      initialPrice: money(Number(raw.initial_price ?? 0)),
      renewalPrice: money(Number(raw.renewal_price ?? 0)),
      billingPeriod: Number.isFinite(Number(raw.billing_period))
        ? Number(raw.billing_period)
        : null,
    };
    planCache.set(planId, { plan, at: Date.now() });
    return plan;
  } catch (error) {
    console.error(`[whop] error leyendo el plan ${planId}:`, error);
    return null;
  }
}

/** Céntimos, no flotantes: 69.1 + 6.37 no puede acabar en 75.47000000000001. */
export function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface WhopCompany {
  title: string | null;
  logoUrl: string | null;
}

const companyCache = new Map<string, { company: WhopCompany; at: number }>();

/**
 * El negocio tal como Whop se lo enseña al comprador: su nombre y su logo, no
 * un logo nuestro. Es lo que hace que la cabecera del checkout y el propio
 * formulario de Whop se vean como la misma tienda.
 *
 * A diferencia de los planes, esto sí exige API key: sin ella se devuelve
 * `null` y la cabecera cae a la inicial del nombre.
 */
export async function getCompany(companyId: string): Promise<WhopCompany | null> {
  const hit = companyCache.get(companyId);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.company;

  try {
    const res = await fetch(`${WHOP_API}/companies/${companyId}`, { headers: auth() });
    if (!res.ok) {
      console.error(`[whop] no se pudo leer la company ${companyId}:`, await res.text());
      return null;
    }
    const raw = await res.json();
    const company: WhopCompany = {
      title: raw.title?.trim() || null,
      logoUrl: raw.logo?.url ?? null,
    };
    companyCache.set(companyId, { company, at: Date.now() });
    return company;
  } catch (error) {
    console.error(`[whop] error leyendo la company ${companyId}:`, error);
    return null;
  }
}

export interface CheckoutSession {
  /** El id `ch_...` con el que se monta el embed. */
  id: string;
  /** El plan que cobra. Siempre uno del dashboard, nunca uno fabricado acá. */
  planId: string | null;
  purchaseUrl: string | null;
}

interface CreateSessionInput {
  /** El plan que se cobra. Uno de los del dashboard, y obligatorio. */
  planId: string;
  /**
   * A dónde vuelve el comprador. Solo con dominio https: Whop rechaza cualquier
   * otro, así que en local se abre la sesión sin él —el embed sigue montando,
   * solo que sin los métodos que necesitan sacar al comprador de la página—.
   */
  redirectUrl?: string;
  metadata?: Record<string, string>;
}

/**
 * Abre una sesión de checkout en Whop, sobre un plan que ya existe.
 *
 * Solo `plan_id`. Esta función NO sabe fabricar planes, y es a propósito: la
 * API deja mandar un objeto `plan` en línea y Whop crea uno nuevo por venta,
 * que es como acabaron colgando del producto planes sueltos que nadie puso ahí
 * —y uno de ellos cobrando 12,74 en vez de 6,37—. Los precios se tocan en el
 * dashboard; acá solo se cobran los planes que hay.
 *
 * Una sesión cobra un solo plan, así que el order bump no viaja en esta: se
 * cobra en una segunda venta con su propio plan. Eso además deja el plan de la
 * sesión en pago único, que es la condición para que `adaptive_pricing` cotice
 * en la moneda del comprador y aparezcan los métodos de pago locales.
 */
export interface SessionResult {
  session: CheckoutSession | null;
  /** Por qué falló, tal como lo contó Whop. Solo se enseña en desarrollo. */
  error?: string;
}

export async function createCheckoutSession(
  input: CreateSessionInput
): Promise<SessionResult> {
  const body = () => ({
    mode: "payment",
    plan_id: input.planId,
    ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {}),
    ...(input.metadata && Object.keys(input.metadata).length
      ? { metadata: input.metadata }
      : {}),
  });

  // Sin reintento sin `company_id`: ese existía porque el plan fabricado lo
  // llevaba en el cuerpo y las API keys scoped a la company lo rechazan. Sin
  // plan fabricado no hay `company_id` que mandar.
  const post = () =>
    fetch(`${WHOP_API}/checkout_configurations`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify(body()),
    });

  if (!process.env.WHOP_API_KEY) {
    // Se distingue de un rechazo de Whop a propósito: es el fallo más común al
    // levantar el proyecto y no hay nada que reintentar.
    const falta = "Falta WHOP_API_KEY: crear la sesión de cobro exige autenticación";
    console.error(`[whop] ${falta}`);
    return { session: null, error: falta };
  }

  try {
    const res = await post();

    if (!res.ok) {
      const cuerpo = await res.text();
      console.error("[whop] no se pudo crear la sesión:", cuerpo);
      return { session: null, error: `Whop respondió ${res.status}: ${cuerpo.slice(0, 200)}` };
    }

    const config = await res.json();
    return {
      session: {
        id: config.id,
        planId: config.plan?.id ?? input.planId,
        purchaseUrl: config.purchase_url
          ? new URL(config.purchase_url, "https://whop.com").toString()
          : null,
      },
    };
  } catch (error) {
    console.error("[whop] error creando la sesión:", error);
    return {
      session: null,
      error: error instanceof Error ? error.message : "Error de red contra Whop",
    };
  }
}
