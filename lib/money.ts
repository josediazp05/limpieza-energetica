/**
 * Importes y métodos de pago locales, en el formato que espera Whop.
 *
 * Dos precisiones distintas, y confundirlas cuesta dinero:
 *
 * - **Cobro** (`chargeDecimals`): los decimales que *lleva* el cargo. Es lo que
 *   define la unidad mínima que pide `amount` de Whop Elements.
 * - **Muestra** (`displayDecimals`): los decimales que se *escriben*. Casi
 *   siempre son los mismos, y a propósito no siempre: el peso colombiano se
 *   cobra en centavos pero se escribe en pesos enteros, así que es 2 y 0.
 *   (Es la misma distinción `decimals` / `display_decimals` de la API de Whop.)
 *
 * El bug que motivó este archivo: COP estaba en la lista de "sin decimales", y
 * así 211.510 COP viajaban al elemento como 211510 unidades mínimas, o sea
 * 2.115 COP. Whop resolvía la lista de métodos contra un importe cien veces
 * menor que el que se iba a cobrar, y cada método tiene mínimo y máximo.
 */

/** Monedas cuya unidad mínima ISO 4217 es la propia unidad. NO incluye COP. */
const SIN_DECIMALES_DE_COBRO = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "isk",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

/** Monedas que se escriben sin céntimos aunque el cargo sí los lleve. */
const SIN_DECIMALES_DE_MUESTRA = new Set([...SIN_DECIMALES_DE_COBRO, "cop"]);

/** Decimales que lleva el cargo: define la unidad mínima de `amount`. */
export function chargeDecimals(currency: string): number {
  return SIN_DECIMALES_DE_COBRO.has(currency.toLowerCase()) ? 0 : 2;
}

/** Decimales con los que se escribe el importe. */
export function displayDecimals(currency: string): number {
  return SIN_DECIMALES_DE_MUESTRA.has(currency.toLowerCase()) ? 0 : 2;
}

/**
 * El importe tal y como se va a cobrar, en unidades enteras de la moneda.
 *
 * Se redondea a la precisión que se le enseña al comprador: si el resumen dice
 * "211.510 COP" el cargo tiene que ser 211510, no 211510,37.
 */
export function roundForCharge(amount: number, currency: string): number {
  const digits = displayDecimals(currency);
  return Math.round(amount * 10 ** digits) / 10 ** digits;
}

/** El mismo importe en unidades mínimas, que es lo que pide `amount`. */
export function toMinorUnits(amount: number, currency: string): number {
  const rounded = roundForCharge(amount, currency);
  return Math.max(1, Math.round(rounded * 10 ** chargeDecimals(currency)));
}

/**
 * Los métodos locales que se piden por moneda.
 *
 * `paymentMethodConfiguration.enabled` no inventa métodos: los restaura sobre
 * los que Whop trae por defecto, de modo que un método que la cuenta no tenga
 * activado igual aparece. La matriz de Whop filtra después por moneda, país e
 * importe, así que pedir de más no muestra nada que el comprador no pueda usar.
 *
 * Los identificadores son los del enum `payment_method_configuration` de la API.
 *
 * OJO — límite de `@whop/elements@1.0.0-beta.0`: el PaymentElement no ofrece
 * ningún método cuyo `next_action_render_modes` sea exactamente `["full_page"]`.
 * Comprobado con `select()` contra la matriz de `GET /v1/payment_method_types`:
 *
 *   cop → pse, bancolombia            NO se ofrecen  (["full_page"])
 *         card, efecty, crypto        sí             (null / con "inline")
 *   eur → ideal, bancontact, mobilepay NO             (["full_page"])
 *         card, sepa_debit, eu_bank_transfer sí
 *   mxn → card_installments_*         NO             (["full_page"])
 *         card, oxxo, spei            sí
 *
 * Pedirlos igual no rompe nada —la matriz filtra— y el día que el beta soporte
 * el paso a página completa aparecen solos. Nequi, Bre-B y Addi ni siquiera
 * están en la matriz de esta cuenta todavía.
 */
const METODOS_LOCALES: Record<string, string[]> = {
  ars: ["rapipago", "modo", "mercado_pago"],
  brl: ["pix", "boleto", "mercado_pago"],
  clp: ["webpay", "servipag", "sencillito", "mercado_pago"],
  cop: ["pse", "nequi", "bancolombia", "bre_b", "efecty", "addi"],
  crc: ["mercado_pago"],
  eur: ["bizum", "sepa_debit", "ideal", "bancontact", "p24", "multibanco", "mb_way"],
  mxn: ["oxxo", "spei", "mercado_pago", "kueski"],
  pen: ["yape", "pago_efectivo", "mercado_pago"],
  uyu: ["mercado_pago"],
};

/** Los métodos locales de esa moneda, o lista vacía si no hay ninguno. */
export function localMethodsFor(currency: string): string[] {
  return METODOS_LOCALES[currency.toLowerCase()] ?? [];
}

/**
 * `paymentMethodConfiguration` para el handle de Payments.
 *
 * Solo vale en la forma `{ currency, amount }`: cuando se pasa `plan`, la
 * configuración la pone el plan y esta se ignora.
 */
export function paymentMethodConfigurationFor(currency: string) {
  const enabled = localMethodsFor(currency);
  if (enabled.length === 0) return {};
  return {
    paymentMethodConfiguration: {
      include_platform_defaults: true,
      enabled,
    },
  };
}

/** Orden de la lista: tarjeta primero y los locales justo detrás. */
export function methodOrderFor(currency: string): string[] {
  const locales = localMethodsFor(currency);
  return locales.length === 0 ? [] : ["card", ...locales];
}
