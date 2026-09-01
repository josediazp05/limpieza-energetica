import { NextRequest, NextResponse } from "next/server";
import { cobrarUnClic, pagoDeLaConfiguracion } from "@/lib/one-click";
import {
  CHECKOUT_CONFIG_COOKIE,
  COOKIE_MAX_AGE,
  PAYMENT_COOKIE,
} from "../../../api/whop/constants";
import { PASOS, esPaso, urlDelPaso, type Paso } from "../../../funnel";

export const dynamic = "force-dynamic";

/**
 * El endpoint que ata un paso del embudo con el siguiente.
 *
 * `GET /f/<paso>/<respuesta>`, y eso es a lo que apuntan los botones de las
 * páginas de cristinalozano-constelaciones.com:
 *
 *   SÍ QUIERO  → https://<este-sitio>/f/up1/si
 *   NO QUIERO  → https://<este-sitio>/f/up1/no
 *
 * El "sí" cobra la tarjeta guardada del checkout inicial y solo entonces
 * redirige. Por eso los botones no pueden apuntar directamente a la página
 * siguiente: ese salto es el cobro.
 *
 * `hecho` es la tercera respuesta y no la pulsa nadie: es a donde vuelve el
 * comprador desde el checkout hosteado de Whop cuando el one-click no se pudo
 * hacer. Significa "esto ya está pagado, sigue" —no vuelve a cobrar—.
 */

/** Parámetros que son nuestros y no viajan a la página siguiente. */
const INTERNOS = new Set(["payment_id", "plan_id", "next", "fallback"]);

function origen(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (proto && host) return `${proto}://${host}`;
  return request.nextUrl.origin;
}

/** El destino, con la atribución de la URL actual y el pago pegados detrás. */
function destino(paso: Paso, request: NextRequest, paymentId: string | null): string {
  const url = new URL(urlDelPaso(paso, origen(request)));
  request.nextUrl.searchParams.forEach((valor, clave) => {
    if (!INTERNOS.has(clave)) url.searchParams.set(clave, valor);
  });
  // Se reenvía aunque también vaya en cookie: si el comprador cambia de
  // navegador —abrir el correo en el móvil, por ejemplo— la cookie no está.
  if (paymentId) url.searchParams.set("payment_id", paymentId);
  return url.toString();
}

/** De quién es la tarjeta: primero la URL, luego las cookies. */
async function pagoDelVisitante(request: NextRequest): Promise<string | null> {
  const enLaUrl = request.nextUrl.searchParams.get("payment_id");
  if (enLaUrl && /^[A-Za-z0-9_]+$/.test(enLaUrl)) return enLaUrl;

  const enCookie = request.cookies.get(PAYMENT_COOKIE)?.value;
  if (enCookie) return enCookie;

  const configId = request.cookies.get(CHECKOUT_CONFIG_COOKIE)?.value;
  if (!configId) return null;
  return pagoDeLaConfiguracion(configId);
}

/** El checkout hosteado de Whop para este plan: el rescate del one-click. */
function alCheckoutDeWhop(paso: Paso, request: NextRequest): string {
  const url = new URL("/api/whop/checkout", origen(request));
  url.searchParams.set("plan_id", paso.planId as string);
  url.searchParams.set("next", `/f/${paso.id}/hecho`);
  url.searchParams.set("fallback", `/f/${paso.id}/no`);
  return url.toString();
}

function redirigir(a: string, paymentId: string | null, seguro: boolean) {
  const respuesta = NextResponse.redirect(a, 303);
  if (paymentId) {
    respuesta.cookies.set(PAYMENT_COOKIE, paymentId, {
      httpOnly: true,
      secure: seguro,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }
  return respuesta;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paso: string; respuesta: string }> }
) {
  const { paso: pasoRaw, respuesta } = await params;
  const seguro = origen(request).startsWith("https");

  if (!esPaso(pasoRaw)) {
    return NextResponse.redirect(urlDelPaso(PASOS.gracias, origen(request)), 303);
  }

  const paso = PASOS[pasoRaw];
  const paymentId = await pagoDelVisitante(request);

  // "No quiero": no se cobra nada, se pasa al siguiente del embudo.
  if (respuesta === "no") {
    const siguiente = paso.no ? PASOS[paso.no] : PASOS.gracias;
    return redirigir(destino(siguiente, request, paymentId), paymentId, seguro);
  }

  // "Ya pagado" (vuelta del checkout hosteado): seguir sin volver a cobrar.
  if (respuesta === "hecho") {
    const siguiente = paso.si ? PASOS[paso.si] : PASOS.gracias;
    return redirigir(destino(siguiente, request, paymentId), paymentId, seguro);
  }

  if (respuesta !== "si") {
    return NextResponse.redirect(urlDelPaso(PASOS.gracias, origen(request)), 303);
  }

  const siguiente = paso.si ? PASOS[paso.si] : PASOS.gracias;

  // Un paso sin plan no vende nada: se pasa de largo. Pasa mientras falte la
  // variable de entorno del plan, y es preferible a dejar al comprador
  // atascado en un error después de haber dicho que sí.
  if (!paso.planId) {
    console.error(
      `[embudo] ${paso.nombre} aceptado pero sin plan configurado: no se cobró nada`
    );
    return redirigir(destino(siguiente, request, paymentId), paymentId, seguro);
  }

  // Sin pago que cobrar —cookies perdidas, enlace sin `payment_id`— la oferta
  // no se tira: se manda al checkout hosteado de Whop, que acepta todos los
  // métodos y vuelve por `/f/<paso>/hecho`.
  if (!paymentId) {
    console.warn(`[embudo] ${paso.nombre} sin pago del visitante: al checkout hosteado`);
    return NextResponse.redirect(alCheckoutDeWhop(paso, request), 303);
  }

  const cobro = await cobrarUnClic(paymentId, paso.planId);

  if (cobro.ok) {
    return redirigir(destino(siguiente, request, paymentId), paymentId, seguro);
  }

  // El one-click falló —lo normal en Colombia: quien pagó por PSE o Efecty no
  // dejó tarjeta—. La venta no se pierde, se cobra en el checkout de Whop.
  console.warn(`[embudo] one-click no cobrado en ${paso.nombre}: ${cobro.error}`);
  return redirigir(alCheckoutDeWhop(paso, request), paymentId, seguro);
}
