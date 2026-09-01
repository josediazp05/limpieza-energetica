import { headers } from "next/headers";

/**
 * Países donde Whop ofrece métodos de pago locales de tipo "empujado" —PSE,
 * Nequi, Efecty, SPEI, OXXO, Pix…—. `setupFutureUsage` los filtra a todos: son
 * pagos que no se pueden volver a cobrar sin el comprador delante.
 */
const PAISES_CON_METODOS_LOCALES = new Set([
  "MX", "CO", "BR", "AR", "CL", "PE", "EC", "UY", "PY", "BO", "VE",
  "CR", "GT", "SV", "HN", "NI", "PA", "DO",
]);

/** El país del comprador, resuelto en el borde (Vercel o Cloudflare). */
export async function buyerCountry(): Promise<string | null> {
  // En local no hay borde que resuelva el país, así que sin esto no hay forma
  // de ver la página como la ve un colombiano —y el precio en pesos se
  // estrenaría en producción sin haberlo mirado nunca—. `DEV_COUNTRY=CO` en
  // .env.local lo simula. Nunca en producción: ahí el país lo dice la IP y
  // nada más, o cualquiera elegiría en qué moneda se le cobra.
  if (process.env.NODE_ENV === "development" && process.env.DEV_COUNTRY) {
    return process.env.DEV_COUNTRY.toUpperCase();
  }
  const h = await headers();
  const raw = h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry");
  return raw?.toUpperCase() ?? null;
}

/**
 * Si el checkout de este comprador debe guardar la tarjeta.
 *
 * Guardarla es lo que permite cobrar el upsell de un clic en /up-whop, pero
 * cuesta todos los métodos locales: un trade-off que solo existe en los
 * mercados que los tienen.
 *
 * Ante la duda, se elige el método local. Perder el upsell de un clic se
 * recupera —el botón cae a un checkout normal—; esconderle al comprador el
 * único medio de pago que puede usar, no.
 */
export async function shouldSaveCard(): Promise<boolean> {
  const pais = await buyerCountry();
  if (!pais) return false;
  return !PAISES_CON_METODOS_LOCALES.has(pais);
}
