/**
 * El embudo de Limpiezas Energéticas — Maldiciones Familiares, tal cual está
 * dibujado en el constructor: quién viene después de cada "SÍ QUIERO" y de cada
 * "NO QUIERO", y qué plan de Whop se cobra al aceptar.
 *
 * Las páginas de venta NO viven en este proyecto: son las de
 * cristinalozano-constelaciones.com. Lo que vive acá es el checkout —el único
 * sitio donde el comprador mete la tarjeta— y los endpoints que atan un paso
 * con el siguiente (`/f/<paso>/<respuesta>`), que son los que cobran el
 * one-click y luego mandan al comprador a la página que toca.
 *
 * Por eso los botones de las páginas externas no apuntan a la página siguiente
 * sino acá: si "SÍ QUIERO" fuera un enlace directo al upsell 2, nadie habría
 * cobrado el upsell 1.
 */

export type PasoId = "checkout" | "up1" | "dw1" | "up2" | "dw2" | "combo" | "gracias";

export interface Paso {
  id: PasoId;
  /** Cómo se llama en el constructor, para los logs. */
  nombre: string;
  /** La página que ve el comprador. Externa salvo el checkout. */
  url: string | null;
  /**
   * El plan de Whop que se cobra cuando dice que sí. `null` en los pasos que
   * no venden nada (el checkout, que cobra con formulario, y la de gracias).
   */
  planId: string | null;
  /** Precio anunciado en USD. Solo para el valor del evento de Meta. */
  valorUsd?: number;
  /** A dónde va tras aceptar (y cobrar). */
  si: PasoId | null;
  /** A dónde va tras rechazar. */
  no: PasoId | null;
}

/** El sitio propio: acá vive el checkout y los endpoints del embudo. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
}

const env = (nombre: string) => process.env[nombre]?.trim() || null;

/**
 * URL de la página de ventas (VSL). No es un paso del embudo —no hay nada que
 * cobrar en ella—, pero es a donde se devuelve a quien llega suelto a `/`.
 */
export const VSL_URL =
  env("FUNNEL_VSL_URL") ??
  "https://cristinalozano-constelaciones.com/vsl-maldiciones-familiares-2026/";

export const PASOS: Record<PasoId, Paso> = {
  // Página de ventas → INICIO → checkout propio. El pago abre el embudo.
  checkout: {
    id: "checkout",
    nombre: "Checkout Limpiezas Energéticas",
    url: "/checkout",
    planId: env("WHOP_PLAN_MAIN"),
    valorUsd: Number(process.env.FUNNEL_VALOR_MAIN ?? 0) || undefined,
    si: "up1",
    no: "up1",
  },
  up1: {
    id: "up1",
    nombre: "UPSELL 1 MALDICIONES",
    url: env("FUNNEL_UP1_URL") ?? "https://up1.cristinalozano-constelaciones.com/",
    planId: env("WHOP_PLAN_UP1"),
    valorUsd: Number(process.env.FUNNEL_VALOR_UP1 ?? 0) || undefined,
    si: "up2",
    no: "dw1",
  },
  dw1: {
    id: "dw1",
    nombre: "DOWNSELL 1 MALDICIONES",
    url: env("FUNNEL_DW1_URL") ?? "https://dw1.cristinalozano-constelaciones.com/",
    planId: env("WHOP_PLAN_DW1"),
    valorUsd: Number(process.env.FUNNEL_VALOR_DW1 ?? 0) || undefined,
    si: "up2",
    no: "combo",
  },
  up2: {
    id: "up2",
    nombre: "UPSELL 2 INTRODUCCIÓN CONSTELACIONES",
    url: env("FUNNEL_UP2_URL") ?? "https://up2.cristinalozano-constelaciones.com/",
    planId: env("WHOP_PLAN_UP2"),
    valorUsd: Number(process.env.FUNNEL_VALOR_UP2 ?? 0) || undefined,
    si: "gracias",
    no: "dw2",
  },
  dw2: {
    id: "dw2",
    nombre: "DOWNSELL 2 INTRODUCCIÓN CONSTELACIONES",
    url: env("FUNNEL_DW2_URL") ?? "https://dw2.cristinalozano-constelaciones.com/",
    planId: env("WHOP_PLAN_DW2"),
    valorUsd: Number(process.env.FUNNEL_VALOR_DW2 ?? 0) || undefined,
    si: "gracias",
    no: "gracias",
  },
  /**
   * COMBO 2X1 — Combo Liberación. En el constructor cuelga del "NO QUIERO" del
   * downsell 1, pero su URL todavía no está publicada: mientras
   * `FUNNEL_COMBO_URL` esté vacía, ese "no" cae directo a la página de gracias
   * en vez de mandar al comprador a un dominio que no existe.
   */
  combo: {
    id: "combo",
    nombre: "COMBO 2X1 LIBERACIÓN",
    url: env("FUNNEL_COMBO_URL"),
    planId: env("WHOP_PLAN_COMBO"),
    valorUsd: Number(process.env.FUNNEL_VALOR_COMBO ?? 0) || undefined,
    si: "gracias",
    no: "gracias",
  },
  gracias: {
    id: "gracias",
    nombre: "PÁGINA GRACIAS",
    url:
      env("FUNNEL_GRACIAS_URL") ??
      "https://graciaseml.cristinalozano-constelaciones.com/",
    planId: null,
    si: null,
    no: null,
  },
};

export const PASOS_VALIDOS = Object.keys(PASOS) as PasoId[];

export function esPaso(valor: string): valor is PasoId {
  return (PASOS_VALIDOS as string[]).includes(valor);
}

/**
 * La URL a la que se manda al comprador para ver un paso.
 *
 * Un paso sin URL —el combo hasta que lo publiquen— no puede enseñarse, así
 * que se salta al de gracias: mejor terminar el embudo que dejar al comprador
 * en un 404 después de haber pagado.
 */
export function urlDelPaso(paso: Paso, origin: string): string {
  if (!paso.url) return PASOS.gracias.url ?? origin;
  if (paso.url.startsWith("/")) return `${origin}${paso.url}`;
  return paso.url;
}
