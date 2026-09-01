import { buyerCountry } from "./geo";

export interface DisplayFx {
  baseCurrency: "USD";
  currency: string;
  exchangeRate: number;
  date?: string;
}

const FRANKFURTER_API = "https://api.frankfurter.dev/v2";

const FALLBACK_USD_RATES: Record<string, number> = {
  ARS: 1335,
  BOB: 6.91,
  BRL: 5.42,
  CAD: 1.38,
  CLP: 954,
  COP: 3065,
  CRC: 503,
  DOP: 63,
  EUR: 0.86,
  GTQ: 7.66,
  HNL: 26.17,
  MXN: 18.7,
  NIO: 36.8,
  PEN: 3.55,
  PYG: 7185,
  UYU: 40,
  VES: 139,
};

const COUNTRY_CURRENCY: Record<string, string> = {
  AR: "ARS",
  BO: "BOB",
  BR: "BRL",
  CA: "CAD",
  CL: "CLP",
  CO: "COP",
  CR: "CRC",
  DO: "DOP",
  EC: "USD",
  ES: "EUR",
  GT: "GTQ",
  HN: "HNL",
  MX: "MXN",
  NI: "NIO",
  PA: "USD",
  PE: "PEN",
  PR: "USD",
  PY: "PYG",
  SV: "USD",
  US: "USD",
  UY: "UYU",
  VE: "VES",
};

function fallbackFx(currency = "USD"): DisplayFx {
  const quote = currency.toUpperCase();
  return {
    baseCurrency: "USD",
    currency: quote,
    exchangeRate: quote === "USD" ? 1 : FALLBACK_USD_RATES[quote] ?? 1,
  };
}

export function currencyForCountry(country: string | null): string {
  if (!country) return "USD";
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? "USD";
}

export async function usdFxForCurrency(currency: string): Promise<DisplayFx> {
  const quote = currency.toUpperCase();
  if (quote === "USD") return fallbackFx("USD");

  try {
    const response = await fetch(`${FRANKFURTER_API}/rate/USD/${quote}`, {
      next: { revalidate: 60 * 60 * 24 },
    });
    const data = (await response.json().catch(() => ({}))) as {
      date?: string;
      quote?: string;
      rate?: number;
      message?: string;
    };

    if (!response.ok || typeof data.rate !== "number" || !Number.isFinite(data.rate)) {
      console.error("[fx] no se pudo leer Frankfurter", {
        currency: quote,
        status: response.status,
        message: data.message,
      });
      return fallbackFx(quote);
    }

    return {
      baseCurrency: "USD",
      currency: quote,
      exchangeRate: data.rate,
      date: data.date,
    };
  } catch (error) {
    console.error("[fx] Frankfurter no respondió", error);
    return fallbackFx(quote);
  }
}

export async function buyerDisplayFx(): Promise<DisplayFx> {
  const country = await buyerCountry();
  return usdFxForCurrency(currencyForCountry(country));
}
