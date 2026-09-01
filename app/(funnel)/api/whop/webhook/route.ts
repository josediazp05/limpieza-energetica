import Whop from "@whop/sdk";
import { NextResponse } from "next/server";
import { sendPurchase, splitName } from "@/lib/meta-capi";

export const dynamic = "force-dynamic";

type PaymentMetadata = Record<string, unknown> | null | undefined;

interface WhopPayment {
  id: string;
  currency?: string | null;
  total?: number | null;
  settlement_amount?: number | null;
  amount_after_fees?: number | null;
  usd_total?: number | null;
  usd_net?: number | null;
  net_usd?: number | null;
  paid_at?: string | null;
  created_at?: string | null;
  user?: { email?: string | null; name?: string | null } | null;
  member?: { id?: string | null; phone?: string | null } | null;
  membership?: { phone_number?: string | null } | null;
  billing_address?: {
    name?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
  plan?: {
    id?: string | null;
    name?: string | null;
    metadata?: PaymentMetadata;
  } | null;
  metadata?: PaymentMetadata;
  product?: { id?: string | null; name?: string | null } | null;
}

function metaString(
  pay: WhopPayment,
  key: string,
  fallback?: string | null
): string | null {
  const direct = pay.metadata?.[key];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const plan = pay.plan?.metadata?.[key];
  if (typeof plan === "string" && plan.trim()) return plan.trim();

  return fallback?.trim() || null;
}

function paidAt(pay: WhopPayment): Date {
  const raw = pay.paid_at ?? pay.created_at;
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? new Date(ms) : new Date();
}

/**
 * Lo que de verdad gana el negocio: el bruto en USD menos los fees de Whop.
 * Whop manda los montos como strings en el webhook, por eso se pasa todo por
 * Number. Si falta algún dato y no se puede calcular, se cae de vuelta al
 * `usd_total` para no perder el evento.
 */
function netValueUsd(pay: WhopPayment): number {
  const usdTotal = Number(pay.usd_total) || 0;
  const gross = Number(pay.total ?? pay.settlement_amount) || 0;
  const afterFees = Number(pay.amount_after_fees) || 0;

  if (usdTotal > 0 && gross > 0 && afterFees > 0) {
    return usdTotal * (afterFees / gross);
  }

  console.warn(
    `pago ${pay.id} sin neto disponible; usando usd_total como fallback`
  );
  return usdTotal;
}

function contentIds(pay: WhopPayment): string[] | undefined {
  const ids = [pay.plan?.id, pay.product?.id].filter(
    (id): id is string => Boolean(id)
  );
  return ids.length ? ids : undefined;
}

export async function POST(req: Request) {
  const key = process.env.WHOP_WEBHOOK_KEY;
  if (!key) {
    console.error("falta WHOP_WEBHOOK_KEY: no se puede verificar el webhook");
    return NextResponse.json({ error: "No configurado" }, { status: 500 });
  }

  let event;
  try {
    const raw = await req.text();
    const headers = Object.fromEntries(req.headers);
    event = new Whop({
      apiKey: process.env.WHOP_API_KEY,
      webhookKey: Buffer.from(key).toString("base64"),
    }).webhooks.unwrap(raw, { headers });
  } catch (err) {
    console.error("webhook de Whop con firma inválida", err);
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  if (event.type !== "payment.succeeded") {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const pay = event.data as WhopPayment;
  // El valor del Purchase es el neto en dólares: lo que de verdad queda en el
  // negocio después de los fees de Whop.
  const value = netValueUsd(pay);

  if (!pay.id || value <= 0) {
    return NextResponse.json({ ok: true, ignored: "invalid_payment" });
  }

  const eventTime = paidAt(pay);
  const { firstName, lastName } = splitName(
    pay.user?.name ?? pay.billing_address?.name
  );
  const ok = await sendPurchase({
    eventId: pay.id,
    eventTime,
    value,
    currency: "USD",
    fbc: metaString(pay, "fbc"),
    fbp: metaString(pay, "fbp"),
    externalId:
      metaString(pay, "meta_external_id") ?? metaString(pay, "external_id"),
    email: pay.user?.email,
    phone: pay.member?.phone ?? pay.membership?.phone_number,
    firstName,
    lastName,
    city: pay.billing_address?.city,
    state: pay.billing_address?.state,
    zip: pay.billing_address?.postal_code,
    country: pay.billing_address?.country,
    clientIp: metaString(pay, "client_ip"),
    clientUserAgent: metaString(pay, "user_agent"),
    sourceUrl: metaString(pay, "source_url", process.env.NEXT_PUBLIC_SITE_URL),
    contentIds: contentIds(pay),
    contentName: pay.product?.name ?? pay.plan?.name,
  });

  console.log(
    `pago ${pay.id}: ${ok ? "Purchase enviado a Meta" : "Meta lo rechazó"}`
  );

  return NextResponse.json({ ok: true, meta: ok, value: Number(value.toFixed(2)) });
}
