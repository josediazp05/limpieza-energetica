/**
 * El cobro de un clic: cobrar la tarjeta que quedó guardada en el checkout
 * inicial, sin volver a pedirle nada al comprador.
 *
 * Vive en `lib` y no dentro de una ruta porque lo usan dos: `/api/whop/charge`
 * —que lo llama desde el navegador, como en kevin-mvp— y los endpoints del
 * embudo `/f/<paso>/si`, que cobran y redirigen en el mismo salto. Si cada uno
 * tuviera su copia, arreglar un caso dejaría el otro roto.
 */

const WHOP_API = "https://api.whop.com/api/v1";

function auth(): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.WHOP_API_KEY}`,
    "Content-Type": "application/json",
  };
}

interface WhopPayment {
  id: string;
  member?: { id: string };
  user?: { id: string };
  payment_method?: { id: string };
}

/**
 * El pago del visitante a partir de SU checkout configuration (la que quedó en
 * cookie). Es como se encuentra la tarjeta cuando el redirect no trae
 * `payment_id`.
 */
export async function pagoDeLaConfiguracion(
  checkoutConfigId: string
): Promise<string | null> {
  const params = new URLSearchParams();
  const companyId = process.env.WHOP_COMPANY_ID;
  if (companyId) params.set("company_id", companyId);
  params.append("checkout_configuration_ids[]", checkoutConfigId);

  try {
    const res = await fetch(`${WHOP_API}/payments?${params}`, { headers: auth() });
    if (!res.ok) {
      console.error("[whop] no se pudieron listar los pagos:", await res.text());
      return null;
    }
    const result: { data?: Array<{ id: string; status?: string | null }> } =
      await res.json();
    const pagos = result.data ?? [];
    // La configuración es de un solo visitante: su primer pago cobrado es la
    // compra inicial, la que dejó la tarjeta.
    const pagado = pagos.find((p) => p.status === "paid") ?? pagos[0];
    return pagado?.id ?? null;
  } catch (error) {
    console.error("[whop] error listando pagos:", error);
    return null;
  }
}

export interface ResultadoCobro {
  ok: boolean;
  chargeId?: string;
  status?: string;
  /** Whop reprodujo un cobro que ya se había hecho: no se movió dinero. */
  duplicado?: boolean;
  error?: string;
  /** 400 = falta información; 402 = la tarjeta no pudo pagar. */
  httpStatus?: number;
}

/**
 * Cobra `planId` contra la tarjeta del pago `paymentId`.
 *
 * El importe NO viaja: se cobra el plan tal como está en Whop. Fabricar planes
 * al vuelo fue lo que en kevin-mvp cobró un bump al doble, porque en un plan
 * recurrente `initial_price` se SUMA al del periodo en vez de sustituirlo.
 */
export async function cobrarUnClic(
  paymentId: string,
  planId: string
): Promise<ResultadoCobro> {
  const companyId = process.env.WHOP_COMPANY_ID;

  const pagoRes = await fetch(`${WHOP_API}/payments/${paymentId}`, { headers: auth() });
  if (!pagoRes.ok) {
    console.error("[whop] no se pudo leer el pago:", await pagoRes.text());
    return { ok: false, error: "No se pudo leer el pago original", httpStatus: 400 };
  }

  const pago: WhopPayment = await pagoRes.json();
  const memberId = pago.member?.id || pago.user?.id;
  const paymentMethodId = pago.payment_method?.id;

  if (!memberId) {
    return { ok: false, error: "El pago no tiene miembro", httpStatus: 400 };
  }

  if (!paymentMethodId) {
    // Pagó por PSE, Nequi, Efecty o Pix: no hay tarjeta que volver a cobrar.
    // Se apunta con quién y qué plan porque es una venta que se rescata a mano
    // —o mandándolo al checkout hosteado, que es lo que hace quien llama.
    console.error(
      `[whop] sin método de pago guardado · plan=${planId} pago=${paymentId} member=${memberId}`
    );
    return {
      ok: false,
      error: "Sin tarjeta guardada: el comprador tiene que pagar en el checkout",
      httpStatus: 400,
    };
  }

  /**
   * La clave que impide cobrar dos veces.
   *
   * Whop guarda 24h la respuesta de cada POST con `Idempotency-Key` y la
   * reproduce ante una repetición en vez de ejecutarla otra vez. Sale del pago
   * y del plan —no de un aleatorio—, así que dos peticiones para la misma
   * oferta del mismo comprador comparten clave por construcción: un doble clic,
   * un reintento de red o un `pageshow` desde el bfcache no cobran dos veces.
   *
   * El reintento sin `company_id` lleva sufijo aparte porque es OTRA petición
   * —cuerpo distinto—: con la misma clave, Whop la rechazaría por reuso.
   */
  const clave = (sufijo: string) => `funnel:${paymentId}:${planId}${sufijo}`;

  const cobrar = (conCompany: boolean) =>
    fetch(`${WHOP_API}/payments`, {
      method: "POST",
      headers: { ...auth(), "Idempotency-Key": clave(conCompany ? "" : ":sin-company") },
      body: JSON.stringify({
        ...(conCompany && companyId ? { company_id: companyId } : {}),
        member_id: memberId,
        payment_method_id: paymentMethodId,
        plan_id: planId,
      }),
    });

  let res = await cobrar(Boolean(companyId));

  // 409: la primera petición con esta clave sigue corriendo, o sea el doble
  // disparo simultáneo. El cobro bueno lo está haciendo ella.
  if (res.status === 409) {
    console.warn(`[whop] cobro duplicado descartado · plan=${planId} pago=${paymentId}`);
    return { ok: true, duplicado: true };
  }

  // Las API keys scoped a la company rechazan `company_id` explícito.
  if (res.status === 400) {
    const cuerpo = await res.clone().text();
    if (cuerpo.toLowerCase().includes("company_id")) {
      res = await cobrar(false);
      if (res.status === 409) {
        console.warn(`[whop] cobro duplicado descartado · plan=${planId} pago=${paymentId}`);
        return { ok: true, duplicado: true };
      }
    }
  }

  const reproducido = res.headers.get("idempotent-replayed") === "true";

  if (!res.ok) {
    const datos = await res.json().catch(() => ({}));
    console.error(
      `[whop] cobro fallido · plan=${planId} pago=${paymentId} member=${memberId}`,
      datos
    );
    const mensaje = datos.message || datos.error || "El cobro no se pudo hacer";
    return { ok: false, error: String(mensaje), httpStatus: 402 };
  }

  const datos = await res.json();
  if (reproducido) {
    console.warn(`[whop] cobro ya hecho, respuesta reproducida · plan=${planId} pago=${paymentId}`);
  }

  return {
    ok: true,
    chargeId: datos.id,
    status: datos.status,
    ...(reproducido ? { duplicado: true } : {}),
  };
}
