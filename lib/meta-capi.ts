import { createHash } from "node:crypto";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

type MetaEventName = "InitiateCheckout" | "Purchase";

interface MetaEvent {
  name: MetaEventName;
  eventId: string;
  eventTime: Date;
  value?: number | null;
  currency?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  externalId?: string | null;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  clientIp?: string | null;
  clientUserAgent?: string | null;
  sourceUrl?: string | null;
  contentIds?: string[];
  contentName?: string | null;
}

export interface MetaResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export type InitiateCheckoutEvent = Omit<MetaEvent, "name">;
export type PurchaseEvent = Omit<MetaEvent, "name" | "value" | "currency"> & {
  value: number;
  currency: string;
};

function hash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(value).digest("hex");
}

function lower(value: string | null | undefined): string | undefined {
  const v = value?.trim().toLowerCase();
  return v || undefined;
}

function normalizeName(value: string | null | undefined): string | undefined {
  const v = lower(value)?.replace(/[^\p{L}\s'-]/gu, "").replace(/\s+/g, " ");
  return v?.trim() || undefined;
}

function normalizePlace(value: string | null | undefined): string | undefined {
  const v = lower(value)?.replace(/[^\p{L}\p{N}]/gu, "");
  return v || undefined;
}

function normalizePhone(value: string | null | undefined): string | undefined {
  const v = value?.replace(/\D/g, "");
  return v && v.length >= 8 ? v : undefined;
}

function normalizeZip(value: string | null | undefined): string | undefined {
  const v = lower(value)?.replace(/\s/g, "");
  return v || undefined;
}

function pii(key: string, value: string | undefined): Record<string, string[]> {
  const h = hash(value);
  return h ? { [key]: [h] } : {};
}

export function splitName(
  fullName: string | null | undefined
): { firstName?: string; lastName?: string } {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };

  const half = Math.ceil(parts.length / 2);
  return {
    firstName: parts.slice(0, half).join(" "),
    lastName: parts.slice(half).join(" "),
  };
}

async function sendEvent(event: MetaEvent): Promise<MetaResponse> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;

  if (!pixelId || !token) {
    return {
      ok: false,
      status: 500,
      body: { error: "Meta CAPI sin configurar" },
    };
  }

  // Whop manda los montos como strings en los webhooks; se normaliza a número
  // antes de toFixed y de que Meta lo valide.
  const value = event.value != null ? Number(event.value) : NaN;

  const customData = {
    ...(Number.isFinite(value) && event.currency
      ? {
          value: Number(value.toFixed(2)),
          currency: event.currency.toUpperCase(),
        }
      : {}),
    ...(event.contentIds?.length ? { content_ids: event.contentIds } : {}),
    ...(event.contentIds?.length ? { content_type: "product" } : {}),
    ...(event.contentName ? { content_name: event.contentName } : {}),
  };

  const body = {
    ...(process.env.META_TEST_EVENT_CODE
      ? { test_event_code: process.env.META_TEST_EVENT_CODE }
      : {}),
    data: [
      {
        event_name: event.name,
        event_time: Math.floor(event.eventTime.getTime() / 1000),
        event_id: event.eventId,
        action_source: "website",
        ...(event.sourceUrl ? { event_source_url: event.sourceUrl } : {}),
        user_data: {
          ...(event.fbc ? { fbc: event.fbc } : {}),
          ...(event.fbp ? { fbp: event.fbp } : {}),
          ...(event.externalId ? { external_id: [event.externalId] } : {}),
          ...pii("em", lower(event.email)),
          ...pii("ph", normalizePhone(event.phone)),
          ...pii("fn", normalizeName(event.firstName)),
          ...pii("ln", normalizeName(event.lastName)),
          ...pii("ct", normalizePlace(event.city)),
          ...pii("st", normalizePlace(event.state)),
          ...pii("zp", normalizeZip(event.zip)),
          ...pii("country", lower(event.country)),
          ...(event.clientIp ? { client_ip_address: event.clientIp } : {}),
          ...(event.clientUserAgent
            ? { client_user_agent: event.clientUserAgent }
            : {}),
        },
        ...(Object.keys(customData).length ? { custom_data: customData } : {}),
      },
    ],
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const json = await response.json().catch(() => null);

    if (!response.ok) {
      console.error(`Meta rechazó el ${event.name}`, json);
    }

    return { ok: response.ok, status: response.status, body: json };
  } catch (error) {
    console.error(`No se pudo mandar el ${event.name} a Meta`, error);
    return {
      ok: false,
      status: 502,
      body: { error: "No se pudo conectar con Meta" },
    };
  }
}

export function sendInitiateCheckout(
  event: InitiateCheckoutEvent
): Promise<MetaResponse> {
  return sendEvent({ name: "InitiateCheckout", ...event });
}

export function sendPurchase(event: PurchaseEvent): Promise<MetaResponse> {
  return sendEvent({ name: "Purchase", ...event });
}
