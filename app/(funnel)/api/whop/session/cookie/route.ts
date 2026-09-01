import { NextRequest, NextResponse } from "next/server";
import { CHECKOUT_CONFIG_COOKIE } from "../../constants";

/**
 * Deja en cookie la sesión que abrió el servidor.
 *
 * La sesión se crea ahora al renderizar la página, y desde un Server Component
 * no se pueden escribir cookies. Pero el iframe no la necesita para montar
 * —solo hace falta después, para que el one-click de /up-whop sepa cuál fue el
 * pago de ESTE visitante—, así que se registra por acá, fuera del camino
 * crítico y sin retrasar el cobro.
 *
 * El id no se guarda a ciegas: se comprueba antes contra Whop. La API key está
 * scoped a la company, así que una configuración ajena responde 404 y no llega
 * a la cookie. Sin esa comprobación, cualquiera podría plantar en el navegador
 * de otro la referencia a un pago que no es suyo, y el upsell cobraría contra
 * una tarjeta que no le corresponde.
 */
export async function POST(request: NextRequest) {
  const { session_id } = await request.json().catch(() => ({}));

  if (typeof session_id !== "string" || !/^ch_[A-Za-z0-9]+$/.test(session_id)) {
    return NextResponse.json({ error: "session_id inválido" }, { status: 400 });
  }

  const res = await fetch(
    `https://api.whop.com/api/v1/checkout_configurations/${session_id}`,
    { headers: { Authorization: `Bearer ${process.env.WHOP_API_KEY}` } }
  );

  if (!res.ok) {
    console.error(`[whop] sesión desconocida al guardar la cookie: ${session_id}`);
    return NextResponse.json({ error: "sesión desconocida" }, { status: 404 });
  }

  const respuesta = NextResponse.json({ ok: true });
  respuesta.cookies.set(CHECKOUT_CONFIG_COOKIE, session_id, {
    httpOnly: true,
    secure: request.nextUrl.origin.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 2, // 2h: checkout + upsell/downsell
  });
  return respuesta;
}
