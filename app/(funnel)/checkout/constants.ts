import { PASOS } from "../funnel";

// Configuración del checkout embebido. Todo lo que se puede querer cambiar
// —copy, qué order bumps salen, a dónde vuelve el comprador— vive acá y en
// ningún otro sitio. Los precios NO: esos los manda Whop en cada carga.

/**
 * El plan del producto principal, el de la VSL de Limpiezas Energéticas.
 * Sale de `WHOP_PLAN_MAIN` para no tener el id de un plan de producción
 * escrito en el repo.
 */
export const MAIN_PLAN_ID = PASOS.checkout.planId ?? "";

/** Solo se usa si Whop no responde. El precio de verdad lo manda la API. */
export const MAIN_FALLBACK_AMOUNT = Number(process.env.FUNNEL_VALOR_MAIN ?? 67) || 67;

export const PRODUCT = {
  /**
   * Nombre y logo del negocio. Vacíos a propósito: lo normal es que los ponga
   * Whop, para que la cabecera y el formulario de pago se vean como la misma
   * tienda. Rellénalos solo para pisar lo que Whop devuelve.
   */
  brand: "",
  brandLogo: "",
  /** Respaldo del nombre si Whop no responde y no hay nada escrito arriba. */
  brandFallback: "Cristina Lozano · Constelaciones",
  name: "Limpiezas Energéticas",
  /**
   * A dónde vuelve el comprador cuando el pago termina.
   *
   * No a una página, sino al endpoint del embudo: `hecho` significa "esto ya
   * está pagado, sigue" y manda al upsell 1 sin volver a cobrar nada. Cambiar
   * el orden del embudo se hace en `funnel.ts`, no acá.
   */
  returnPath: "/f/checkout/hecho",
};

/**
 * El arte de la columna de venta.
 *
 * Vacío mientras no estén las piezas de Cristina: la maqueta aguanta sin ellas
 * —la columna se queda con el titular, el resumen y el cobro— y así el checkout
 * no arranca pidiendo imágenes que no existen. Se rellenan poniendo los
 * archivos en `public/assets/...` y sus medidas reales acá.
 */
export interface PiezaArte {
  src: string;
  width: number;
  height: number;
  alt: string;
  /** Ancho al que se dibuja. Sin él ocupa todo el ancho de la columna. */
  ancho?: number;
  margin?: string;
  /** Versión de móvil, cuando es otra composición y no la misma reescalada. */
  movil?: { src: string; width: number; height: number };
}

export const ARTE: {
  /** La pieza de arriba, entre el titular y el order bump. */
  hero: { src: string; width: number; height: number; alt: string } | null;
  /** La columna de venta, en el orden en que se lee. */
  laterales: PiezaArte[];
  /** El carrusel de testimonios de abajo del todo. */
  carrusel: { src: string; alt: string }[];
} = {
  hero: null,
  laterales: [],
  carrusel: [],
};

export interface OrderBump {
  id: string;
  /** El plan de Whop del que sale el precio y la recurrencia reales. */
  planId: string;
  title: string;
  description: string;
  /** Cinta naranja arriba a la derecha. Vacío = sin cinta. */
  badge?: string;
  /** Miniatura de 64px. Vacío = el cuadro gris del diseño. */
  imageUrl?: string;
  /**
   * Precio ancla. De él sale el tachado y el porcentaje de la pastilla verde,
   * así que no es decorativo: cambiarlo cambia el descuento que se anuncia.
   * 0 = sin ancla, y entonces ni pastilla ni tachado.
   */
  compareAtUsd?: number;
  /** Marcado de entrada. */
  defaultOn?: boolean;
  /** Respaldos por si Whop no responde. */
  fallbackTodayUsd: number;
  fallbackMonthlyUsd: number;
}

/**
 * Los order bumps del checkout.
 *
 * Ninguno de entrada: en este embudo las ofertas extra son los upsells y
 * downsells del constructor, que van en páginas aparte (ver `funnel.ts`). Si
 * se quiere además un bump dentro del checkout, se añade acá con su plan de
 * Whop y aparece solo.
 *
 * Una sesión de Whop cobra un solo plan, así que un bump aceptado no es una
 * línea aparte: se cobra en una segunda venta contra la misma tarjeta, igual
 * que los upsells (ver `pricing.ts` y `lib/one-click.ts`).
 */
export const ORDER_BUMPS: OrderBump[] = [];
