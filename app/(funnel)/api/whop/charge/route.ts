import { NextRequest, NextResponse } from "next/server";
import { CHECKOUT_CONFIG_COOKIE } from "../constants";
import { cobrarUnClic, pagoDeLaConfiguracion } from "@/lib/one-click";

/**
 * Cobro de un clic desde el navegador.
 *
 * Es la misma operación que hacen los endpoints del embudo (`/f/<paso>/si`),
 * expuesta como JSON para las páginas que prefieren cobrar sin navegar —un
 * botón que se queda en la página y decide él a dónde ir—. La lógica está en
 * `lib/one-click.ts`; acá solo se resuelve de quién es la tarjeta.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const planId = typeof body.plan_id === "string" ? body.plan_id : null;
    let paymentId = typeof body.payment_id === "string" ? body.payment_id : undefined;

    if (!planId) {
      return NextResponse.json({ error: "Falta plan_id" }, { status: 400 });
    }

    if (!paymentId) {
      const configId = request.cookies.get(CHECKOUT_CONFIG_COOKIE)?.value;
      if (configId) paymentId = (await pagoDeLaConfiguracion(configId)) ?? undefined;
      if (!paymentId) {
        return NextResponse.json({ error: "Falta payment_id" }, { status: 400 });
      }
    }

    const resultado = await cobrarUnClic(paymentId, planId);

    if (!resultado.ok) {
      return NextResponse.json(
        { error: resultado.error },
        { status: resultado.httpStatus ?? 402 }
      );
    }

    return NextResponse.json({
      success: true,
      charge_id: resultado.chargeId,
      status: resultado.status,
      ...(resultado.duplicado ? { duplicado: true } : {}),
    });
  } catch (error) {
    console.error("[whop] error en el cobro de un clic:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
