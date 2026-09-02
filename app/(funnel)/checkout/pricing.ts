import { getPlan, money } from "@/lib/whop";
import { MAIN_FALLBACK_AMOUNT, MAIN_PLAN_ID, ORDER_BUMPS } from "./constants";

// Cuánto cuesta un pedido. Lo comparten la página —que lo pinta— y la ruta que
// abre la sesión —que lo cobra—, para que no puedan discrepar: si el precio se
// calculara dos veces, un día el resumen diría una cifra y Whop cobraría otra.
//
// Los precios salen de Whop en cada carga y no se guardan: un plan repreciado
// en el dashboard no puede dejar la página anunciando algo que el cobro ya no
// hace. Los respaldos del copy solo entran si Whop no responde.

export interface BumpPrice {
  id: string;
  planId: string;
  productId: string | null;
  /** Lo que suma hoy. */
  today: number;
  /** Lo que suma en cada renovación. 0 = pago único. */
  monthly: number;
  /**
   * El precio ancla —el tachado y el % de la pastilla—, ya en la moneda del
   * pedido. No se cobra, pero se anuncia: en pesos no puede quedarse en el
   * importe base del copy o el tachado diría "13 COP".
   */
  compareAt: number;
  /** Días entre cobros. `null` si no es recurrente. */
  billingPeriod: number | null;
}

export interface OrderPricing {
  /** Moneda base del plan principal. */
  currency: string;
  /** Producto al que pertenece el plan principal en Whop. */
  mainProductId: string | null;
  /** Tipo de plan principal: pago único o renovación. */
  mainPlanType: "one_time" | "renewal";
  /** Lo que cuesta hoy el producto principal, sin bumps. */
  mainToday: number;
  /** Precio de cada bump, esté aceptado o no: la página los pinta todos. */
  bumps: Record<string, BumpPrice>;
}

/**
 * Los precios de todo lo que hay en la página, tal como está hoy en Whop.
 *
 * Todos en la moneda base del plan principal. Lo que ve el comprador en la
 * suya lo convierte Whop dentro del iframe, y la página copia esa misma tasa
 * para el resumen.
 */
export async function loadPricing(): Promise<OrderPricing> {
  const [mainPlan, bumpPlans] = await Promise.all([
    // Sin `WHOP_PLAN_MAIN` puesto no hay plan que leer: se cae al respaldo del
    // copy en vez de pedirle a Whop un plan con id vacío.
    MAIN_PLAN_ID ? getPlan(MAIN_PLAN_ID) : Promise.resolve(null),
    Promise.all(ORDER_BUMPS.map((bump) => getPlan(bump.planId))),
  ]);

  // Los respaldos del copy ya están en la moneda del plan. La página los
  // convierte al pintarlos, con la tasa del iframe.
  const respaldo = (amount: number) => money(amount);

  const bumps: Record<string, BumpPrice> = {};
  ORDER_BUMPS.forEach((bump, index) => {
    const plan = bumpPlans[index];
    const recurrente = plan?.planType === "renewal";
    const mensual = recurrente
      ? money(plan.renewalPrice)
      : plan
        ? 0
        : respaldo(bump.fallbackMonthlyUsd);

    // Lo que se paga hoy, con la regla de Whop y no con la que parece.
    //
    // En un plan recurrente, `initial_price` NO es el precio del primer
    // periodo: es "an additional amount charged upon first purchase", un
    // recargo que se SUMA al del periodo. Así que hoy se paga la renovación
    // más ese recargo, y un `initial_price: 0` —como el del bump— significa
    // sin recargo, no primer periodo gratis.
    //
    // Leerlo al revés fue lo que cobró el bump a 12,74: se fabricaba un plan
    // con initial_price = renewal_price creyendo que fijaba el primer mes.
    const hoy = plan
      ? recurrente
        ? money(plan.renewalPrice + plan.initialPrice)
        : money(plan.initialPrice)
      : respaldo(bump.fallbackTodayUsd);

    bumps[bump.id] = {
      id: bump.id,
      planId: bump.planId,
      productId: plan?.productId ?? null,
      today: hoy,
      monthly: mensual,
      compareAt: respaldo(bump.compareAtUsd ?? 0),
      billingPeriod: recurrente ? (plan.billingPeriod ?? 30) : null,
    };
  });

  const mainAmount = money(mainPlan?.initialPrice ?? MAIN_FALLBACK_AMOUNT);

  return {
    currency: mainPlan?.currency ?? "eur",
    mainProductId: mainPlan?.productId ?? null,
    mainPlanType: mainPlan?.planType ?? "one_time",
    // Nunca se convierte acá: es el importe base de Whop. Lo que ve el
    // comprador lo convierte Whop dentro del iframe.
    mainToday: mainAmount,
    bumps,
  };
}

export interface OrderTotal {
  /** Lo que cobra la sesión de Whop: el producto y nada más. */
  today: number;
  /** Los bumps que de verdad entraron, ya filtrados contra los que existen. */
  accepted: BumpPrice[];
}

/**
 * Qué lleva el pedido. Los ids llegan del navegador, así que se filtran contra
 * los bumps que existen: uno inventado simplemente no suma nada.
 *
 * El importe NO suma los bumps, y no es un descuido: cada bump es una segunda
 * venta contra la tarjeta de la primera —ver `constants.ts`—, así que la sesión
 * de Whop cobra el producto solo. El total que ve el comprador lo compone la
 * página sumando las dos, ya convertidas a su moneda con la tasa del iframe.
 *
 * Cobrar por separado también quita el problema de los ciclos: cada bump
 * recurrente es su propia suscripción, con su periodo, en vez de tener que
 * caber todos en el único ciclo que admite un plan combinado.
 */
export function totalFor(pricing: OrderPricing, bumpIds: string[]): OrderTotal {
  const accepted = bumpIds
    .filter((id, index) => bumpIds.indexOf(id) === index)
    .map((id) => pricing.bumps[id])
    .filter((bump): bump is BumpPrice => Boolean(bump));

  return { today: pricing.mainToday, accepted };
}
