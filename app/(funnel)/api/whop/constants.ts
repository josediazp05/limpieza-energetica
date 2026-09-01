/** Cookie que correlaciona al visitante con SU checkout configuration de Whop. */
export const CHECKOUT_CONFIG_COOKIE = "whop_ccfg";

/**
 * Cookie con el pago inicial del visitante (`pay_...`).
 *
 * Las páginas del embudo son de otro dominio y no siempre devuelven el
 * `payment_id` en el enlace: basta que un botón se copie sin el parámetro para
 * que el upsell siguiente se quede sin tarjeta que cobrar. Con el pago
 * apuntado acá el embudo sobrevive a eso, porque los `/f/...` se visitan como
 * navegación de primer nivel y una cookie `SameSite=Lax` sí viaja en ellas.
 */
export const PAYMENT_COOKIE = "whop_pay";

/** Lo que duran las dos: checkout + upsells + downsells de una sesión. */
export const COOKIE_MAX_AGE = 60 * 60 * 2;
