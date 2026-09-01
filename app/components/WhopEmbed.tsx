"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  WhopCheckoutEmbed,
  useCheckoutEmbedControls,
  type WhopCheckoutCompleteResult,
  type WhopCheckoutCurrenciesAvailable,
  type WhopCheckoutCurrencyChanged,
  type WhopCheckoutPaymentError,
} from "@whop/checkout/react";

export interface DisplayCurrency {
  baseCurrency: string;
  currency: string;
  exchangeRate: number;
}

interface WhopEmbedProps {
  /** Sesión de checkout de Whop (`ch_...`). El plan lo decide quien la abrió. */
  sessionId?: string;
  /**
   * El plan a pelo, sin sesión. Es el respaldo cuando no se pudo abrir una
   * —Whop caído, o en local sin API key—: monta y cobra igual, pero sin la
   * metadata de atribución y sin poder sumar order bumps.
   */
  planId?: string;
  /**
   * A dónde vuelve el comprador. Whop lo exige para poder mandarlo fuera y
   * traerlo de vuelta: 3DS, PSE, Nequi, SPEI y Pix salen todos de la página y
   * sin esta URL el embed ni siquiera los ofrece. Tiene que ser https absoluta.
   */
  returnUrl?: string;
  /**
   * Guardar la tarjeta para poder cobrar el upsell de un clic. Cuesta caro: con
   * ella Whop filtra todos los métodos locales, así que la decisión se toma en
   * el servidor y por país.
   */
  saveCard?: boolean;
  /**
   * Los mandos del formulario —`submit()`, `setDisplayCurrency()`…—. Los crea
   * quien use este componente cuando necesita disparar el cobro desde fuera:
   * con `hideSubmitButton` el botón del iframe desaparece y el de la página
   * ocupa su lugar. Si no se pasa, se usa uno interno.
   */
  controls?: ReturnType<typeof useCheckoutEmbedControls>;
  /** Esconder el botón de comprar del iframe, para poner uno propio. */
  hideSubmitButton?: boolean;
  /** Cada cambio de estado del formulario: `loading`, `ready` o `disabled`. */
  onEstado?: (estado: "loading" | "ready" | "disabled") => void;
  /** Contenido que el SDK de Whop enseña antes de hidratar y montar el iframe. */
  fallback?: ReactNode;
  /**
   * Esconder el aviso legal y la firma de Whop que el embed pinta debajo del
   * botón. Se rehacen en la página, junto al sello de compra segura, para que
   * el pie del cobro sea uno y no dos pegados.
   */
  hideTermsAndConditions?: boolean;
  /**
   * Esconder el importe del formulario de pago.
   *
   * El iframe solo conoce el plan que él cobra. Cuando el pedido se cobra en
   * dos ventas —producto en dólares, order bump en moneda local— su "Total a
   * pagar hoy" es el del producto solo, y en la misma pantalla contradice al
   * total del resumen. El importe que manda es el del resumen, que sí desglosa
   * las dos líneas.
   */
  hidePrice?: boolean;
  /** Moneda y tasa que Whop está mostrando realmente dentro del iframe. */
  onDisplayCurrencyChange?: (currency: DisplayCurrency) => void;
  accentColor?: string;
  buttonText?: string;
  /**
   * Se llama cuando el formulario de Whop termina de montarse dentro del
   * iframe —su estado pasa a `ready`—, no cuando se abre la sesión. Entre una
   * cosa y otra hay un hueco en el que el hueco del cobro está en blanco.
   */
  onReady?: () => void;
  /**
   * Se llama cuando el cobro termina bien. Pasarlo hace que Whop NO redirija
   * —lo activa el propio embed—, que es lo que permite encadenar un segundo
   * cobro sin sacar al comprador de la página.
   */
  onComplete?: (result: WhopCheckoutCompleteResult) => void;
  /** Fallos de procesamiento que el embed ya conoce: tarjeta, 3DS o redirect externo. */
  onPaymentError?: (error: WhopCheckoutPaymentError) => void;
}

/**
 * El formulario de pago de Whop.
 *
 * `adaptivePricing` solo deja DISPONIBLE la moneda del comprador; no cambia a
 * ella. Y los métodos locales —PSE, Nequi, Efecty, SPEI, Pix— solo aparecen si
 * el checkout corre en esa moneda, así que en cuanto Whop la ofrece se cambia.
 */
export default function WhopEmbed({
  sessionId,
  planId,
  returnUrl,
  saveCard = false,
  hidePrice = false,
  hideTermsAndConditions = false,
  hideSubmitButton = false,
  controls: controlsProp,
  fallback,
  onEstado,
  onDisplayCurrencyChange,
  accentColor = "#05943c",
  buttonText = "Comprar ahora",
  onReady,
  onComplete,
  onPaymentError,
}: WhopEmbedProps) {
  const controlsPropios = useCheckoutEmbedControls();
  const controls = controlsProp ?? controlsPropios;
  const [targetCurrency, setTargetCurrency] = useState<string | null>(null);
  const baseCurrency = useRef("USD");
  const raiz = useRef<HTMLDivElement>(null);

  /**
   * Cuándo está montado el formulario de verdad.
   *
   * El `ready` que manda Whop por `onStateChange` no es de fiar: en pruebas
   * llegó una de cada cuatro veces. Así que la señal buena se mira acá: Whop
   * va ajustando el alto del iframe mientras mide su contenido —y es en ese
   * rato cuando el documento de dentro asoma su barra de scroll—, de modo que
   * el momento en que dejó de cambiar de alto ES el momento en que terminó.
   *
   * `ready` sigue conectado por si llega antes; el primero que hable gana.
   */
  useEffect(() => {
    if (!onReady) return;
    const nodo = raiz.current;
    if (!nodo) return;

    let avisado = false;
    let quieto: ReturnType<typeof setTimeout> | undefined;
    const avisar = () => {
      if (avisado) return;
      avisado = true;
      onReady();
    };
    // El alto con el que nace el iframe es el de reserva del embed, no el del
    // formulario: se queda ahí quieto un rato y solo después Whop lo ajusta a
    // lo que de verdad mide. Contar la quietud desde el principio lo daba por
    // terminado justo antes del único momento que importa, así que el reloj no
    // arranca hasta que ese primer ajuste ha ocurrido.
    let altoPrevio: number | null = null;
    let ajustado = false;

    const medir = (alto: number) => {
      if (altoPrevio === null) {
        altoPrevio = alto;
        return;
      }
      if (Math.abs(alto - altoPrevio) < 1) return;
      altoPrevio = alto;
      ajustado = true;
      // 300ms sin que el alto se mueva. Menos que eso lo daba por terminado
      // entre dos ajustes seguidos de Whop.
      clearTimeout(quieto);
      quieto = setTimeout(avisar, 300);
    };

    let ro: ResizeObserver | undefined;
    const enganchar = (iframe: HTMLIFrameElement) => {
      ro = new ResizeObserver((entradas) => {
        for (const e of entradas) medir(e.contentRect.height);
      });
      ro.observe(iframe);
      medir(iframe.getBoundingClientRect().height);
      // Si el ajuste no llega nunca —un formulario que ya cabe en el alto de
      // reserva— no se puede esperar indefinidamente al cambio que no habrá.
      quieto = setTimeout(() => {
        if (!ajustado) avisar();
      }, 2500);
    };

    const yaEsta = nodo.querySelector("iframe");
    if (yaEsta) enganchar(yaEsta);

    // El iframe no está en el primer render: lo pone el embed al montarse.
    const mo = new MutationObserver(() => {
      const iframe = nodo.querySelector("iframe");
      if (iframe && !ro) enganchar(iframe);
    });
    mo.observe(nodo, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      ro?.disconnect();
      clearTimeout(quieto);
    };
    // La sesión nueva trae iframe nuevo: hay que volver a engancharse.
  }, [onReady, sessionId, planId, saveCard]);

  const publishCurrency = useCallback(
    (currency: string, exchangeRate: number | null) => {
      const base = baseCurrency.current.toUpperCase();
      const current = currency.toUpperCase();
      const rate = current === base ? 1 : exchangeRate;
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return;
      onDisplayCurrencyChange?.({ baseCurrency: base, currency: current, exchangeRate: rate });
    },
    [onDisplayCurrencyChange]
  );

  const onCurrenciesAvailable = useCallback(
    (snapshot: WhopCheckoutCurrenciesAvailable) => {
      baseCurrency.current = snapshot.base_currency.toUpperCase();
      publishCurrency(snapshot.current_currency, snapshot.exchange_rate);
      if (!snapshot.optional_currency) return;
      if (snapshot.current_currency === snapshot.optional_currency) return;
      setTargetCurrency(snapshot.optional_currency);
    },
    [publishCurrency]
  );

  const onCurrencyChanged = useCallback(
    (snapshot: WhopCheckoutCurrencyChanged) => {
      publishCurrency(snapshot.currency, snapshot.exchange_rate);
    },
    [publishCurrency]
  );

  // El embed puede anunciar sus monedas antes de que el ref esté conectado, y
  // entonces `setDisplayCurrency` no haría nada —sin error ni reintento— y el
  // precio se quedaría en dólares para siempre, sin métodos locales.
  useEffect(() => {
    if (!targetCurrency) return;
    let cancelado = false;
    let intentos = 0;

    const aplicar = () => {
      if (cancelado) return;
      const actual = controls.current;
      if (!actual) {
        if (intentos++ < 20) setTimeout(aplicar, 150);
        return;
      }
      actual.setDisplayCurrency(targetCurrency).catch((e: unknown) => {
        console.error("[checkout] no se pudo cambiar a la moneda local", e);
      });
    };

    aplicar();
    return () => {
      cancelado = true;
    };
  }, [targetCurrency, controls, sessionId]);

  return (
    // `display: contents`: hace de asa para llegar al iframe sin meter una
    // caja de más en medio del layout del cobro.
    <div ref={raiz} style={{ display: "contents" }}>
    <WhopCheckoutEmbed
      // `setupFutureUsage` viaja en la URL del iframe y se lee solo al montar:
      // sin meterlo en la `key`, cambiar de política no surtiría efecto. Y la
      // sesión cambia al marcar un order bump: sin remontar, Whop se quedaría
      // cobrando el total anterior.
      key={`${sessionId ?? planId}:${saveCard ? "save" : "local"}`}
      ref={controls}
      {...(sessionId ? { sessionId } : { planId: planId as string })}
      returnUrl={returnUrl}
      setupFutureUsage={saveCard ? "off_session" : undefined}
      hidePrice={hidePrice}
      fallback={fallback}
      hideTermsAndConditions={hideTermsAndConditions}
      hideSubmitButton={hideSubmitButton}
      adaptivePricing
      onCurrenciesAvailable={onCurrenciesAvailable}
      onCurrencyChanged={onCurrencyChanged}
      // El `ready` de Whop es el atajo, no la señal principal: llega de forma
      // irregular —una de cada cuatro veces en pruebas—, y por eso quien manda
      // es el observador del alto de arriba. Se deja conectado porque cuando sí
      // llega, llega antes.
      {...(onReady || onEstado
        ? {
            onStateChange: (estado: "loading" | "ready" | "disabled") => {
              onEstado?.(estado);
              if (estado === "ready") onReady?.();
            },
          }
        : {})}
      {...(onComplete ? { onComplete: (_id, _receipt, result) => onComplete(result) } : {})}
      {...(onPaymentError ? { onPaymentError } : {})}
      theme="light"
      locale="es"
      themeOptions={{ accentColor, buttonText }}
      styles={{ container: { paddingX: 0, paddingY: 0 } }}
    />
    </div>
  );
}
