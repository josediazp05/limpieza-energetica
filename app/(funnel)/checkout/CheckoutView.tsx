"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useCheckoutEmbedControls,
  type WhopCheckoutCompleteResult,
  type WhopCheckoutPaymentError,
} from "@whop/checkout/react";
import WhopEmbed, { type DisplayCurrency } from "@/app/components/WhopEmbed";
import { ARTE, ORDER_BUMPS, PRODUCT, type OrderBump } from "./constants";
import type { Brand } from "./brand";
import { totalFor, type BumpPrice, type OrderPricing } from "./pricing";

/**
 * El ancho del cobro: es lo que mide el formulario de Whop. Más ancho, el campo
 * de la tarjeta se lee como un buscador.
 */
const PAGO_ANCHO = 496;

/** Lo más ancho que llega a medir la maqueta partida, centrada en la ventana. */
const SPLIT_ANCHO = 1600;

/**
 * Los documentos legales del cobro.
 *
 * Son los de Whop, que es quien procesa el pago y a cuyos términos se adhiere
 * el comprador: el embed enlazaba exactamente estos antes de que le
 * quitáramos su aviso. Si el negocio publica los suyos, se cambian acá.
 */
const LEGAL = {
  terminos: "https://whop.com/tos/",
  privacidad: "https://whop.com/privacy/",
};

const ENLACE_LEGAL: React.CSSProperties = {
  color: "inherit",
  textDecoration: "none",
};

/**
 * El aire de las dos mitades en escritorio.
 *
 * El de arriba va atado al alto de la ventana y no fijo: en una pantalla
 * apaisada —un portátil de 1300×524, sin ir más lejos— un valor fijo se comía
 * buena parte de lo que se ve antes de empezar a leer. Con `5vh` se encoge
 * donde estorba y crece donde sobra, entre 24 y 44.
 */
const PANE_PADDING = "clamp(24px, 5vh, 44px) 40px 88px";

/**
 * La mitad del cobro arranca un poco más abajo que la de la venta.
 *
 * No es capricho: lo primero de esa columna es el formulario de Whop, que trae
 * su propio marco y sus campos, y pegado al borde de arriba se lee como si se
 * saliera de la página. La otra mitad empieza con un rótulo y un titular, que
 * aguantan mucho mejor el aire corto.
 */
const PANE_PADDING_COBRO = "clamp(32px, 7vh, 64px) 40px 88px";
const CONTENT_ANCHO = 520;

/**
 * El arte de la columna de venta —la pieza de arriba, las laterales y el
 * carrusel— vive en `constants.ts` junto al resto de lo que se cambia sin
 * tocar la maqueta. Acá solo se dibuja, y si no hay piezas puestas la columna
 * se queda con el titular, el resumen y el cobro, que es lo que de verdad
 * cobra.
 */
const { hero: HERO, laterales: LATERALES, carrusel: CARRUSEL_SLIDES } = ARTE;

const C = {
  text: "#111113",
  muted: "#6F7177",
  subtle: "#8A8D94",
  /**
   * El gris del overlay de carga —el mark de Whop y su rótulo—. Más claro que
   * el resto: ahí no hay nada que leer con atención, solo algo que espera, y
   * al peso de los demás grises pedía demasiado protagonismo.
   */
  cargandoGris: "#B4B7BD",
  border: "#E6E8EE",
  danger: "#D92D20",
  /** El verde de marca del cobro: el botón del embed. */
  accent: "#05943c",

  // --- La mitad izquierda, ya en claro (el fondo lo pide el diseño) ---
  lienzo: "#FAFAFA",
  /** Titulares y cifras sobre el lienzo. */
  tinta: "#111113",
  /** Etiquetas del resumen y texto de apoyo. */
  tintaSuave: "#5C5C5C",

  // --- La tarjeta del order bump, cotejada contra Figma ---
  bumpBorde: "rgba(225,226,231,0.9)",
  /** El borde al marcar: el mismo verde del acento, aclarado — a toda
   * intensidad competía demasiado con el fondo #F0F9F3 de al lado. */
  bumpBordeSeleccionado: "rgba(5,148,60,0.35)",
  bumpTitulo: "#373737",
  bumpTexto: "#595959",
  bumpTachado: "rgba(111,113,119,0.64)",
  /** El hueco de la casilla sin marcar: en blanco se perdía sobre la tarjeta. */
  bumpCajaFondo: "#F7F7F7",
  bumpCaja: "#5B5B73",
  /** La pastilla del descuento. */
  descuentoDe: "#00B232",
  descuentoA: "#00992B",
  /** La cinta de "Cupos limitados". */
  cintaFondo: "rgba(255,148,55,0.29)",
  cintaBorde: "rgba(255,148,55,0.45)",
  cintaTinta: "#F67200",
};

/**
 * La familia del checkout: Inter en su corte de texto, el que trae el archivo
 * por defecto. No se fuerza `opsz` en ningún sitio, para que todo case con los
 * rótulos que Whop pinta dentro del iframe.
 */
const FUENTE = "var(--font-inter), Inter, sans-serif";

const ZERO_DECIMAL = new Set(["jpy", "krw", "clp", "pyg", "vnd", "cop"]);

/**
 * El "$" solo no basta: es el mismo signo del peso colombiano y del mexicano.
 * Como Whop cobra en la moneda del comprador, el número tiene que llegarle sin
 * ninguna duda de en qué está.
 */
function formatMoney(value: number, currency = "USD"): string {
  const cur = currency.toLowerCase();
  const digits = ZERO_DECIMAL.has(cur) ? 0 : 2;
  const locale = cur === "usd" ? "en-US" : "es";
  const suffix = cur === "usd" ? " USD" : "";
  try {
    return (
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: cur.toUpperCase(),
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value) + suffix
    );
  } catch {
    return `${value.toFixed(digits)} ${cur.toUpperCase()}`;
  }
}

/** "mes", "año", "30 días" — cómo se dice el ciclo de cobro de un plan. */
function periodLabel(days: number | null): string {
  if (days === 30 || days === 31) return "mes";
  if (days === 365) return "año";
  if (days === 7) return "semana";
  return `${days} días`;
}

/**
 * El sello del negocio: su logo de Whop, y si no tiene ninguno subido, la
 * inicial de su nombre en un recuadro azul —el mismo recurso que usa Whop
 * cuando a una company le falta el logo—. Antes había un asset del repo
 * cableado acá, que no era el logo del negocio sino uno cualquiera.
 */
function BrandMark({ brand }: { brand: Brand }) {
  const size = 26;
  if (brand.logoUrl) {
    return (
      // El logo viene del CDN de Whop; con `<img>` no hay que registrar
      // dominios de terceros en next.config para un avatar de 26px.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logoUrl}
        alt=""
        style={{ width: size, height: size, borderRadius: 8, objectFit: "contain" }}
      />
    );
  }

  const initial = brand.name.trim()[0]?.toUpperCase() ?? "";
  return (
    <span
      aria-hidden="true"
      style={{
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: 8,
        background: "rgba(47,109,246,0.14)",
        border: "1px solid rgba(47,109,246,0.45)",
        color: "#2F6DF6",
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {initial}
    </span>
  );
}

/**
 * El mark de Whop mientras se prepara la sesión de pago. Va inline —no como
 * `/assets/svg/whop-mark-loading.svg`, que se deja de referencia— porque cada
 * raya necesita su propio delay de animación y un `<img>` no deja tocar las
 * partes de adentro de un SVG. El `fill` viene por prop porque el archivo
 * original es blanco puro, pensado para fondo oscuro, y este loader vive
 * sobre el panel blanco del cobro.
 */
/**
 * Cuánto sube el dibujo dentro de su marco, en unidades del viewBox.
 *
 * El marco es el del logo quieto (`0 0 383.2 196.4`), pero lo que se ve no es
 * el logo quieto: cada raya se estira hasta el 125% desde su punta de
 * abajo-izquierda, y las tres van desfasadas, así que la mancha que dibuja la
 * animación entera no queda donde está el logo parado. Centrar el `<svg>`
 * dejaba esa mancha 15.3px por debajo del centro de la columna —medido
 * muestreando la envolvente a lo largo de un ciclo completo—, que con el
 * tamaño de este loader son estas 61 unidades.
 *
 * Va en el `viewBox` y no en un `transform` porque la caja del `<svg>` tiene
 * que seguir midiendo lo mismo: lo que se mueve es el dibujo dentro de ella,
 * y el `overflow: visible` se encarga de que no se recorte por abajo.
 *
 * Probar otro marco que contuviera el estirón entero fue peor: como las tres
 * rayas nunca llegan al pico a la vez, ese hueco de arriba casi no se usa y el
 * desfase subía a 21px.
 */
const SUBIDA_OPTICA = 61;

function WhopLoadingMark({ size = 40, color }: { size?: number; color: string }) {
  const bars = [
    "M60.9,0C35.7,0,18.4,11.1,5.2,23.5c0,0-5.3,5-5.2,5.2l55.2,55.2l55.2-55.2C99.9,14.3,80.2,0,60.9,0z",
    "M197.2,0c-25.2,0-42.5,11.1-55.7,23.5c0,0-4.8,4.9-5.1,5.2L68.2,96.9l55.1,55.1L246.6,28.7C236.1,14.3,216.5,0,197.2,0z",
    "M333.8,0c-25.2,0-42.5,11.1-55.7,23.5c0,0-5,4.9-5.2,5.2L136.4,165.2l14.4,14.4c22.3,22.3,58.9,22.3,81.3,0L383,28.7h0.2C372.8,14.3,353.1,0,333.8,0z",
  ];
  return (
    <svg
      width={size}
      height={size * (196.4 / 383.2)}
      viewBox={`0 ${SUBIDA_OPTICA} 383.2 196.4`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      // Red de seguridad por si el redondeo del marco se queda corto: el
      // estirón nunca debe verse cortado contra el borde, porque entonces
      // vuelve a leerse como un recorte y no como un estirón.
      style={{ overflow: "visible" }}
    >
      {bars.map((d, i) => (
        <path
          key={d}
          className="whop-loading-mark__bar"
          style={{ animationDelay: `${i * 300}ms` }}
          fill={color}
          d={d}
        />
      ))}
    </svg>
  );
}

/**
 * El order bump, cotejado contra Figma (nodo 2394:6909).
 *
 * La casilla va abajo y con su propio rótulo a propósito: arriba se leía como
 * una lista de la compra ya hecha, y aquí es algo que hay que aceptar.
 */
function BumpRow({
  bump,
  price,
  compareAt,
  checked,
  onToggle,
  format,
}: {
  bump: OrderBump;
  price: BumpPrice;
  compareAt: number;
  checked: boolean;
  onToggle: (next: boolean) => void;
  format: (value: number) => string;
}) {
  const recurrente = price.monthly > 0;
  // El precio que se anuncia y contra el que se calcula el ancla es el de hoy;
  // si el bump renueva, el "/mes" se pega detrás en vez de inventar otra línea.
  const sufijo = recurrente ? `/${periodLabel(price.billingPeriod)}` : "";
  const descuento =
    compareAt > price.today && compareAt > 0
      ? Math.round(((compareAt - price.today) / compareAt) * 100)
      : 0;

  return (
    <label
      className="checkout-bump"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        background: checked ? "#F0F9F3" : "#FFFFFF",
        color: C.text,
        border: `1px solid ${checked ? C.bumpBordeSeleccionado : C.bumpBorde}`,
        borderRadius: 16,
        padding: "var(--bump-padding-top, 23px) 21px 21px",
        cursor: "pointer",
        boxShadow: "0 1px 2px rgba(17,17,19,0.04)",
        transition: "background 140ms ease, border-color 140ms ease",
      }}
    >
      {bump.badge && (
        <span
          className="checkout-bump-cinta"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            display: "flex",
            alignItems: "center",
            height: 27.6,
            padding: "4px 13px",
            borderRadius: 8,
            background: C.cintaFondo,
            border: `1px solid ${C.cintaBorde}`,
            color: C.cintaTinta,
            fontSize: "var(--bump-cinta, 13.6px)",
            fontWeight: 600,
            letterSpacing: "-0.136px",
            lineHeight: "12px",
          }}
        >
          {bump.badge}
        </span>
      )}

      <span style={{ display: "flex", gap: 16, alignItems: "center", paddingBottom: 5 }}>
        {/* Sin miniatura queda el cuadro gris del diseño: da el mismo peso a la
            fila que cuando la hay, así que poner o quitar la imagen no descuadra. */}
        {bump.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bump.imageUrl}
            alt=""
            style={{
              width: "var(--bump-miniatura, 60px)",
              height: "var(--bump-miniatura, 60px)",
              borderRadius: 11,
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        ) : (
          <span
            aria-hidden="true"
            style={{
              width: "var(--bump-miniatura, 60px)",
              height: "var(--bump-miniatura, 60px)",
              borderRadius: 11,
              background: "#D9D9D9",
              flexShrink: 0,
            }}
          />
        )}

        <span style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <strong
            style={{
              color: C.bumpTitulo,
              // `globals.css` lo baja en móvil: a 18.6 el título come dos
              // líneas junto a la cinta de "Cupos limitados".
              fontSize: "var(--bump-titulo, 17px)",
              fontWeight: 600,
              letterSpacing: "-0.186px",
              lineHeight: 1.25,
            }}
          >
            {bump.title}
          </strong>

          <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {descuento > 0 && (
              <span
                className="checkout-bump-descuento"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 1,
                  height: 24,
                  padding: "4px 5.5px",
                  borderRadius: 7,
                  background: `linear-gradient(180deg, ${C.descuentoDe} 0%, ${C.descuentoA} 100%)`,
                  border: "1px solid rgba(255,255,255,0.57)",
                  color: "#FFFFFF",
                  fontSize: "var(--bump-descuento, 13.6px)",
                  fontWeight: 600,
                  letterSpacing: "-0.136px",
                  lineHeight: "12px",
                  whiteSpace: "nowrap",
                }}
              >
                {/* La flecha exportada de Figma. Allí va volteada para que apunte
                    hacia abajo, así que se voltea igual aquí. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/assets/svg/descuento-flecha.svg"
                  alt=""
                  width={16}
                  height={16}
                  style={{ display: "block", transform: "scaleY(-1)" }}
                />
                {descuento}%
              </span>
            )}

            {compareAt > 0 && (
              <span
                className="checkout-bump-tachado"
                style={{
                  color: C.bumpTachado,
                  // El mismo tamaño que el precio de hoy, y ambos por la misma
                  // variable: `globals.css` la baja en pantallas estrechas,
                  // donde el par no cabe de una línea con la pastilla.
                  fontSize: "var(--bump-precio, 16px)",
                  fontWeight: 500,
                  letterSpacing: "-0.16px",
                  lineHeight: "21px",
                  textDecoration: "line-through",
                  whiteSpace: "nowrap",
                }}
              >
                {format(compareAt)}
              </span>
            )}

            {compareAt > 0 && (
              <span
                aria-hidden="true"
                className="checkout-bump-tachado"
                style={{ width: 1, height: 18, background: "#373737", flexShrink: 0 }}
              />
            )}

            <span
              style={{
                color: "#000000",
                fontSize: "var(--bump-precio, 16px)",
                fontWeight: 600,
                lineHeight: "21px",
                whiteSpace: "nowrap",
              }}
            >
              {price.today > 0 ? `${format(price.today)}${sufijo}` : "Gratis"}
            </span>
          </span>
        </span>
      </span>

      <span aria-hidden="true" style={{ height: 1, background: C.border, width: "100%" }} />

      <span
        style={{
          color: C.bumpTexto,
          fontSize: "var(--bump-descripcion, 15.4px)",
          fontWeight: 400,
          letterSpacing: "-0.16px",
          lineHeight: 1.45,
        }}
      >
        {bump.description}
      </span>

      <span
        style={{
          display: "flex",
          gap: 9,
          alignItems: "center",
          borderTop: `1px solid ${C.border}`,
          paddingTop: 15,
        }}
      >
        {/* La casilla del diseño no es la del sistema, así que se apaga su
            pintado y se dibuja la caja. Sigue siendo un input de verdad: recibe
            foco, responde al teclado y lo anuncia el lector de pantalla. */}
        <span style={{ position: "relative", display: "grid", flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onToggle(e.target.checked)}
            className="bump-check__box"
            style={{
              appearance: "none",
              WebkitAppearance: "none",
              margin: 0,
              width: 21,
              height: 21,
              borderRadius: 6.4,
              border: `1.167px solid ${checked ? C.accent : C.bumpCaja}`,
              background: checked ? C.accent : C.bumpCajaFondo,
              cursor: "pointer",
            }}
          />
          {/* El check siempre está montado: si se monta y desmonta con el
              booleano no hay nada que transicionar, entra y sale de golpe.
              Aquí se queda y solo cambia de opacidad y escala, que es lo que
              permite el fundido con rebote (cotejado contra Figma, nodo 2403:28). */}
          <span
            aria-hidden="true"
            className="t-success-check bump-check__mark"
            data-state={checked ? "in" : "out"}
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
            }}
          >
            <svg width={11} height={8.008} viewBox="0 0 11 8.00847" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M4.55097 7.60974L11 1.15962L9.84038 0L3.58498 6.25321L1.15962 3.82894L0 4.98856L2.619 7.60974L2.72402 7.70273C2.98626 7.91559 3.31801 8.02387 3.65533 8.0067C3.99266 7.98953 4.31169 7.84813 4.55097 7.60974Z"
                fill="#FFFFFF"
              />
            </svg>
          </span>
        </span>

        <span
          style={{
            color: C.text,
            fontSize: 15.5,
            fontWeight: 600,
            letterSpacing: "-0.155px",
            lineHeight: "18.9px",
          }}
        >
          Añadir a mi compra
        </span>
      </span>
    </label>
  );
}

/**
 * El carrusel de abajo del todo, cotejado contra Figma (nodo 2395:8202): la
 * caja gris de 520×380, sus dos flechas circulares y los puntos de abajo.
 *
 * Sin contenido puesto —ver `CARRUSEL_SLIDES`— pero ya navegable: flechas,
 * puntos y arrastre con el dedo, con vuelta al principio al pasar el final.
 */
/** Las flechas del carrusel: más discretas en un móvil que en el escritorio. */
const FLECHA_DESK = 44;
const FLECHA_MOVIL = 40;

/** Lo que se separan del borde del carrusel. En móvil, más pegadas. */
const FLECHA_MARGEN_DESK = 15;
const FLECHA_MARGEN_MOVIL = 6;

function SlideCarousel({
  slides,
  showPagination = false,
}: {
  slides: { src: string; alt: string }[];
  showPagination?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [trackIndex, setTrackIndex] = useState(1);
  const [snapSinAnimacion, setSnapSinAnimacion] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const [flecha, setFlecha] = useState(FLECHA_DESK);
  const [margenFlecha, setMargenFlecha] = useState(FLECHA_MARGEN_DESK);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => {
      setFlecha(query.matches ? FLECHA_MOVIL : FLECHA_DESK);
      setMargenFlecha(query.matches ? FLECHA_MARGEN_MOVIL : FLECHA_MARGEN_DESK);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const snapFrame = useRef<number | null>(null);
  const animando = useRef(false);
  const unlockTimer = useRef<number | null>(null);
  const count = slides.length;
  const hasSlides = count > 0;
  const renderedSlides = hasSlides ? [slides[count - 1], ...slides, slides[0]] : [];

  useEffect(() => {
    return () => {
      if (snapFrame.current !== null) window.cancelAnimationFrame(snapFrame.current);
      if (unlockTimer.current !== null) window.clearTimeout(unlockTimer.current);
    };
  }, []);

  const releaseNavigation = () => {
    animando.current = false;
    if (unlockTimer.current !== null) {
      window.clearTimeout(unlockTimer.current);
      unlockTimer.current = null;
    }
  };

  const lockNavigation = () => {
    animando.current = true;
    if (unlockTimer.current !== null) window.clearTimeout(unlockTimer.current);
    unlockTimer.current = window.setTimeout(releaseNavigation, 520);
  };

  const go = (delta: number) => {
    if (!hasSlides || animando.current) return;
    if (snapFrame.current !== null) window.cancelAnimationFrame(snapFrame.current);
    lockNavigation();
    setSnapSinAnimacion(false);
    setTrackIndex((i) => i + delta);
    setIndex((i) => (i + delta + count) % count);
  };

  const goTo = (next: number) => {
    if (!hasSlides || animando.current || next === index) return;
    if (snapFrame.current !== null) window.cancelAnimationFrame(snapFrame.current);
    lockNavigation();
    setSnapSinAnimacion(false);
    setTrackIndex(next + 1);
    setIndex(next);
  };

  const snapToRealSlide = (nextTrackIndex: number) => {
    setSnapSinAnimacion(true);
    setTrackIndex(nextTrackIndex);
    snapFrame.current = window.requestAnimationFrame(() => {
      snapFrame.current = window.requestAnimationFrame(() => {
        setSnapSinAnimacion(false);
        snapFrame.current = null;
        releaseNavigation();
      });
    });
  };

  const settleLoop = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    if (!hasSlides) return;
    if (trackIndex === 0) {
      snapToRealSlide(count);
      return;
    }
    if (trackIndex === count + 1) {
      snapToRealSlide(1);
      return;
    }
    releaseNavigation();
  };

  // Las flechas son blancas con el trazo oscuro: sobre un slide claro no se
  // ven. Se mide la luminosidad media del slide actual y, si es clara, se
  // invierte el icono para mantener el contraste (lo mismo para las dos).
  const [invertIcons, setInvertIcons] = useState(false);
  useEffect(() => {
    const slide = slides[index];
    if (!slide) return;
    let cancelled = false;
    const img = new window.Image();
    img.src = slide.src;
    img.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 32, 32);
        const { data } = ctx.getImageData(0, 0, 32, 32);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        }
        const lum = sum / (data.length / 4) / 255;
        setInvertIcons(lum >= 0.5);
      } catch {
        setInvertIcons(false);
      }
    };
    img.onerror = () => setInvertIcons(false);
    return () => {
      cancelled = true;
    };
  }, [slides, index]);

  return (
    <div
      className="checkout-carousel"
      style={{
        position: "relative",
        width: "100%",
        maxWidth: CONTENT_ANCHO,
        aspectRatio: "520 / 380",
        background: "#D9D9D9",
        border: `1px solid ${C.bumpBorde}`,
        borderRadius: 16,
        boxShadow: "0 1px 2px rgba(17,17,19,0.04)",
        overflow: "hidden",
        touchAction: "pan-y",
      }}
      onPointerDown={(e) => {
        dragFrom.current = e.clientX;
      }}
      onPointerUp={(e) => {
        if (dragFrom.current === null) return;
        const delta = e.clientX - dragFrom.current;
        dragFrom.current = null;
        // 40px de arrastre real antes de pasar de slide: menos que eso es un
        // clic con la mano temblorosa, no una intención de deslizar.
        if (Math.abs(delta) > 40) go(delta < 0 ? 1 : -1);
      }}
    >
      {hasSlides ? (
        <div
          className="checkout-carousel__track"
          onTransitionEnd={settleLoop}
          style={{
            transform: `translate3d(-${trackIndex * 100}%, 0, 0)`,
            transition: snapSinAnimacion ? "none" : undefined,
          }}
        >
          {renderedSlides.map((slide, renderedIndex) => (
            <span
              key={`${slide.src}-${renderedIndex}`}
              className="checkout-carousel__slide"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={slide.src}
                alt={slide.alt}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
              />
            </span>
          ))}
        </div>
      ) : (
        <span aria-hidden="true" style={{ position: "absolute", inset: 0 }} />
      )}

      <button
        type="button"
        aria-label="Anterior"
        onClick={() => go(-1)}
        disabled={!hasSlides}
        style={{
          position: "absolute",
          left: margenFlecha,
          top: "calc(50% + 0.3px)",
          transform: "translateY(-50%)",
          width: flecha,
          height: flecha,
          padding: 0,
          border: "none",
          background: "transparent",
          display: "grid",
          placeItems: "center",
          cursor: hasSlides ? "pointer" : "default",
          opacity: hasSlides ? 1 : 0.45,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/svg/prev-icon.svg"
          alt=""
          width={flecha}
          height={flecha}
          style={{ display: "block", filter: invertIcons ? "invert(1)" : "none" }}
        />
      </button>

      <button
        type="button"
        aria-label="Siguiente"
        onClick={() => go(1)}
        disabled={!hasSlides}
        style={{
          position: "absolute",
          right: margenFlecha,
          top: "calc(50% + 0.3px)",
          transform: "translateY(-50%)",
          width: flecha,
          height: flecha,
          padding: 0,
          border: "none",
          background: "transparent",
          display: "grid",
          placeItems: "center",
          cursor: hasSlides ? "pointer" : "default",
          opacity: hasSlides ? 1 : 0.45,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/svg/next-icon.svg"
          alt=""
          width={flecha}
          height={flecha}
          style={{ display: "block", filter: invertIcons ? "invert(1)" : "none" }}
        />
      </button>

      {showPagination && (
        <span
          className="checkout-carousel__pagination"
          style={{
            position: "absolute",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            display: "flex",
            gap: 8,
          }}
        >
          {hasSlides && (
            <span
              aria-hidden="true"
              className="checkout-carousel__pagination-indicator"
              style={{ transform: `translateX(${index * 16}px)` }}
            />
          )}
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Ir al slide ${i + 1}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => goTo(i)}
              className="checkout-carousel__pagination-dot"
              style={{
                width: 8,
                height: 8,
                borderRadius: 8,
                background: "#FFFFFF",
                opacity: 0.4,
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            />
          ))}
        </span>
      )}
    </div>
  );
}

export interface CheckoutViewProps {
  /** Nombre y logo del negocio, ya leídos de Whop en el servidor. */
  brand: Brand;
  /** Precios ya leídos de Whop en el servidor. */
  pricing: OrderPricing;
  /** Absoluta y https, o nada: Whop rechaza cualquier otra. La pone el servidor. */
  returnUrl?: string;
  /** Si el comprador de este país permite guardar la tarjeta (ver lib/geo.ts). */
  saveCard: boolean;
  /**
   * La sesión que ya abrió el servidor. Con ella el iframe monta en cuanto
   * hidrata, sin el viaje de ida y vuelta a `/api/whop/session` que antes lo
   * retrasaba. `null` si Whop no respondió: entonces se pide desde acá.
   */
  sesionInicial?: string | null;
  /**
   * El `?status=` con el que Whop devuelve al comprador. `error` es un pago que
   * falló o que canceló: sin decírselo, la página se ve idéntica a la primera
   * vez y nadie entiende por qué no pasó nada.
   */
  returnedStatus?: string;
}

export default function CheckoutView({
  brand,
  pricing,
  returnUrl,
  saveCard,
  sesionInicial = null,
  returnedStatus,
}: CheckoutViewProps) {
  const [accepted, setAccepted] = useState<string[]>(() =>
    ORDER_BUMPS.filter((b) => b.defaultOn).map((b) => b.id)
  );
  // Con qué monta el embed: la sesión del total, o —si no se pudo abrir— el
  // plan principal a pelo, que cobra igual aunque sin atribución.
  const [mount, setMount] = useState<{ sessionId?: string; planId?: string } | null>(
    sesionInicial ? { sessionId: sesionInicial } : null
  );
  const [error, setError] = useState<string | null>(null);
  /**
   * Si el formulario de Whop terminó de montarse dentro del iframe. No basta
   * con tener sesión: entre abrirla y ver los campos hay un hueco en blanco, y
   * el sello de "Compra 100% segura" colgando debajo de ese vacío se lee como
   * si la página se hubiera roto.
   */
  const [pagoListo, setPagoListo] = useState(false);
  /**
   * Los mandos del formulario de Whop y en qué estado está.
   *
   * El botón de comprar ya no vive dentro del iframe —`hideSubmitButton`— sino
   * debajo del pedido, que es donde el comprador acaba de decidir qué se lleva.
   * Pulsarlo llama a `submit()`, y el formulario valida y cobra igual que si se
   * hubiera pulsado el suyo.
   *
   * `disabled` es Whop diciendo que aún faltan datos —correo, tarjeta,
   * dirección—. El botón se apaga con él, para no prometer un pago que el
   * formulario va a rechazar.
   */
  const controls = useCheckoutEmbedControls();
  const raizPago = useRef<HTMLDivElement>(null);
  const [estadoPago, setEstadoPago] = useState<"loading" | "ready" | "disabled">("loading");
  const [cobrando, setCobrando] = useState(false);
  /**
   * Si lo que se está cargando es un cambio del pedido y no la primera vez.
   * Cambia lo que dice el overlay: "cargando el pago" la primera vez es lo que
   * el comprador espera leer; a la segunda ya sabe que hay un pago y lo que no
   * entiende es por qué se ha ido, así que se le dice qué se está rehaciendo.
   */
  const [recargando, setRecargando] = useState(false);
  /**
   * Lo que el comprador ya había tecleado, para no hacérselo repetir.
   *
   * Marcar el order bump rehace el iframe y con él el formulario en blanco.
   * Whop deja leer el correo y la dirección y volver a ponerlos, así que se
   * copian antes de rehacerlo y se reponen cuando el nuevo está listo.
   *
   * La tarjeta no: no hay `getCard` ni lo va a haber. Esos datos viven dentro
   * del iframe de Whop y no salen de ahí ni para nosotros, que es justo como
   * tiene que ser. Quien ya la hubiera tecleado la tiene que volver a poner.
   */
  type Direccion = Parameters<
    NonNullable<ReturnType<typeof useCheckoutEmbedControls>["current"]>["setAddress"]
  >[0];
  const tecleado = useRef<{ email?: string; address?: Direccion } | null>(null);
  const [currency, setCurrency] = useState<DisplayCurrency>({
    baseCurrency: pricing.currency.toUpperCase(),
    currency: pricing.currency.toUpperCase(),
    exchangeRate: 1,
  });
  const requestSeq = useRef(0);

  const acceptedKey = accepted.join(",");
  /** Lo que suman hoy los bumps aceptados, en su propia moneda. */
  const bumpsHoy = accepted.reduce((sum, id) => sum + (pricing.bumps[id]?.today ?? 0), 0);
  /**
   * Los planes que hay que cobrar en la segunda venta: todos los aceptados.
   *
   * Sin repetidos. Cada entrada de esta lista es un cobro, así que un id
   * duplicado en `accepted` sería el bump cobrado dos veces.
   */
  const planesAparte = useMemo(
    () => [...new Set(accepted.map((id) => pricing.bumps[id]?.planId).filter(Boolean))],
    // `acceptedKey` y no `accepted`: el array se recrea en cada render y
    // arrastraría con él a `cobrarBumps`, que viaja al embed como `onComplete`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricing, acceptedKey]
  );
  const mustSaveCard = useCallback(
    (ids: string[]) => saveCard || ids.some((id) => Boolean(pricing.bumps[id]?.planId)),
    [pricing, saveCard]
  );

  /**
   * La segunda venta: el bump, contra el método de pago que quedó en la compra
   * del producto. Para el comprador no hay nada más que hacer.
   *
   * Si falla —fondos, 3DS, banco— NO se le dice nada y se le lleva a la página
   * de siempre: se ha llevado el producto, que es lo que sí pagó, y un aviso
   * ahí solo sería ruido sobre un cobro que él no puede arreglar. El fallo
   * queda en el log del servidor con su `member` para rescatarlo a mano.
   */
  const yaCobrado = useRef(false);
  const cobrarBumps = useCallback(async (completion: WhopCheckoutCompleteResult) => {
    // Una sola vez por carga. El `onComplete` del iframe puede llegar más de
    // una vez —y entre el primero y la redirección hay tiempo de sobra para
    // que llegue el segundo—, y cada vuelta de este bucle es dinero. El
    // servidor manda una clave de idempotencia que ya lo impide del todo; esto
    // evita además el viaje de ida y vuelta.
    if (yaCobrado.current) return;
    yaCobrado.current = true;

    for (const planId of planesAparte) {
      try {
        const res = await fetch("/api/whop/charge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan_id: planId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("[checkout] el order bump no se pudo cobrar", planId, data);
        }
      } catch (e) {
        console.error("[checkout] el order bump no se pudo cobrar", planId, e);
      }
    }
    console.info("[checkout] compra principal completada", {
      planId: completion?.plan_id,
      receiptId: completion?.receipt_id,
    });
    if (returnUrl) window.location.href = returnUrl;
  }, [planesAparte, returnUrl]);

  const onPaymentError = useCallback((checkoutError: WhopCheckoutPaymentError) => {
    setCobrando(false);
    setError(
      checkoutError.message ||
        "El pago no se pudo procesar. Revisa los datos e intenta de nuevo."
    );
    if (checkoutError.code) {
      console.warn("[checkout] pago rechazado por Whop", checkoutError);
    }
  }, []);
  // El mismo cálculo que hace el servidor antes de cobrar: si el resumen usara
  // otro, un día diría una cifra y Whop cobraría otra.
  const total = useMemo(
    () => totalFor(pricing, acceptedKey ? acceptedKey.split(",") : []),
    [pricing, acceptedKey]
  );

  /**
   * Un importe del pedido, escrito en la moneda que el iframe está mostrando.
   *
   * Los importes vienen en la moneda base del plan que se va a cobrar. Esta
   * escribe lo que el iframe esté enseñando: si Whop lo convirtió a pesos, en
   * pesos.
   */
  const display = useCallback(
    (value: number) => {
      const amount = Math.round(value * 100) / 100;
      if (currency.currency === currency.baseCurrency) {
        return formatMoney(amount, currency.baseCurrency);
      }
      return formatMoney(amount * currency.exchangeRate, currency.currency);
    },
    [currency]
  );

  /**
   * El bump se cobra en la misma moneda base del producto, así que pasa por la
   * misma conversión del iframe. Lo que se enseña es lo que Whop va a cobrar.
   */
  const displayBump = display;

  /**
   * El total que ve el comprador: una sola cifra, aunque por detrás sean dos
   * ventas. Las dos están en la misma moneda base, así que se suman antes de
   * convertir.
   */
  const displayTotal = useCallback(
    (mainAmount: number, bumpsAmount: number) => display(mainAmount + bumpsAmount),
    [display]
  );

  const onCurrency = useCallback((next: DisplayCurrency) => {
    setCurrency((current) =>
      current.baseCurrency === next.baseCurrency &&
      current.currency === next.currency &&
      current.exchangeRate === next.exchangeRate
        ? current
        : next
    );
  }, []);

  /**
   * Pide la sesión del total actual. Cada cambio de bump invalida la anterior:
   * el `seq` descarta respuestas que llegan tarde y dejarían el iframe cobrando
   * un importe que ya no es el que está marcado en pantalla.
   *
   * Con un respiro de por medio: marcar y desmarcar tres veces seguidas no debe
   * abrir tres sesiones en Whop, solo la del total con el que se quedó.
   *
   * Pero solo a partir de la segunda: en la primera carga no hay ningún clic
   * que agrupar, y esperar el respiro eran 350ms de formulario en blanco
   * regalados encima de los ~400 que ya cuesta abrir la sesión en Whop.
   */
  const primeraSesion = useRef(true);
  /**
   * Nada hace que la sesión tenga que rehacerse.
   *
   * Cobra `MAIN_PLAN_ID` marque el comprador el bump o no —el bump va en una
   * segunda venta— y de la metadata solo se lee la de Meta, que es del
   * visitante y tampoco cambia. Rehacerla al marcar la casilla sería pedirle a
   * Whop una sesión idéntica a la que ya había, y eso cuesta casi un segundo de
   * formulario en blanco.
   *
   * El efecto de abajo se queda para el único caso en el que sí hay algo que
   * pedir: que el servidor no lograra abrir la sesión con el HTML.
   */

  useEffect(() => {
    // Con la sesión del servidor puesta, la primera vuelta no tiene nada que
    // pedir: repetirla abriría en Whop una segunda sesión idéntica y dejaría
    // huérfana la que ya viajó en el HTML.
    if (primeraSesion.current && sesionInicial) {
      primeraSesion.current = false;
      return;
    }
    const respiro = primeraSesion.current ? 0 : 350;
    primeraSesion.current = false;
    const timer = setTimeout(async () => {
      const seq = ++requestSeq.current;
      setError(null);
      try {
        const res = await fetch("/api/whop/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bumpIds: acceptedKey ? acceptedKey.split(",") : [] }),
        });
        const data = await res.json().catch(() => ({}));
        if (seq !== requestSeq.current) return;
        if (!res.ok) {
          // `detalle` solo llega en desarrollo, y dice por qué de verdad falló.
          throw new Error(
            [data.error ?? "No se pudo preparar el pago", data.detalle]
              .filter(Boolean)
              .join(" — ")
          );
        }
        setMount(
          data.sessionId
            ? { sessionId: data.sessionId }
            : data.fallbackPlanId
              ? { planId: data.fallbackPlanId }
              : null
        );
      } catch (e) {
        if (seq !== requestSeq.current) return;
        // Se descuelga el iframe además de avisar. Si se dejara montado, seguiría
        // siendo el del pedido anterior: alguien podría pagar 216.818 COP con el
        // resumen prometiendo 236.834. Mejor sin cobro que con el cobro que no es.
        setMount(null);
        setError(e instanceof Error ? e.message : "No se pudo preparar el pago");
      }
    }, respiro);
    return () => clearTimeout(timer);
    // Sin dependencias: marcar un bump ya no cambia lo que cobra la sesión, así
    // que no hay nada que volver a pedirle a Whop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * La cookie de la sesión que abrió el servidor.
   *
   * Va aparte y después, porque un Server Component no puede escribir cookies.
   * No corre prisa: el iframe no la necesita para montar, solo hace falta más
   * tarde para que el one-click de /up-whop encuentre este pago. Si fallara, el
   * upsell no se queda sin salida —cae al checkout hosteado de Whop—, así que
   * no vale la pena molestar al comprador con esto.
   */
  useEffect(() => {
    if (!sesionInicial) return;
    let cancelado = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const guardar = () => {
      if (cancelado) return;
      fetch("/api/whop/session/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sesionInicial }),
      }).catch((e) => console.error("[checkout] no se pudo guardar la sesión", e));
    };

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(guardar, { timeout: 3500 });
    } else {
      timeoutId = setTimeout(guardar, 1800);
    }

    return () => {
      cancelado = true;
      if (idleId !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [sesionInicial]);

  /**
   * El seguro del `ready`.
   *
   * El formulario va oculto hasta que Whop avisa de que terminó de montarse.
   * Si ese aviso no llegara —una versión del embed que deje de mandarlo, un
   * fallo suyo— el cobro se quedaría invisible y no habría forma de comprar.
   * A los 6 segundos se enseña igual: un formulario a medio pintar es un mal
   * menor al lado de un checkout que no aparece.
   */
  useEffect(() => {
    if (!mount || pagoListo) return;
    const t = setTimeout(() => {
      console.warn("[checkout] Whop no avisó de que el formulario estaba listo");
      setPagoListo(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [mount, pagoListo]);

  // Dos mitades no caben en un móvil: por debajo de 900px se apilan, el
  // contenido arriba y el cobro debajo.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  /**
   * Devolver al formulario nuevo lo que el comprador ya había escrito.
   *
   * Lo primero es esperar a que el iframe esté a la vista, y no es un detalle:
   * el navegador congela los iframes de otro origen mientras están fuera de la
   * pantalla, así que `setEmail` no le llega y se pierde sin dar error. Con el
   * order bump debajo del formulario, cuando alguien lo marca el formulario ha
   * quedado arriba y muchas veces fuera del encuadre — que es justo el caso en
   * el que esto tenía que funcionar.
   *
   * Después, reintentos: `ready` dice que el formulario está pintado, no que ya
   * acepte que le metan datos, y en ese hueco los mensajes también se pierden
   * en silencio. Se insiste y se comprueba leyendo, porque `setEmail` resuelve
   * igual aunque el formulario no lo haya tomado.
   */
  const reponerTecleado = useCallback(async () => {
    const previo = tecleado.current;
    if (!previo || (!previo.email && !previo.address)) return;
    tecleado.current = null;

    const iframe = raizPago.current?.querySelector("iframe");
    if (iframe) {
      await new Promise<void>((resolve) => {
        const io = new IntersectionObserver((entradas) => {
          if (entradas.some((e) => e.isIntersecting)) {
            io.disconnect();
            resolve();
          }
        });
        io.observe(iframe);
        // Si nunca llega a verse, no dejar la promesa colgada para siempre.
        setTimeout(() => {
          io.disconnect();
          resolve();
        }, 30000);
      });
    }

    for (let intento = 0; intento < 12; intento++) {
      await new Promise((r) => setTimeout(r, intento === 0 ? 150 : 400));
      const mandos = controls.current;
      if (!mandos) continue;
      try {
        if (previo.email) await mandos.setEmail(previo.email, 2000);
        if (previo.address) await mandos.setAddress(previo.address, 2000);
        const puesto = previo.email ? await mandos.getEmail(2000).catch(() => "") : previo.email;
        if (!previo.email || puesto === previo.email) {
          if (process.env.NODE_ENV === "development") {
            console.log(`[checkout] datos repuestos al intento ${intento + 1}`);
          }
          return;
        }
      } catch {
        // el formulario aún no escucha; se reintenta
      }
    }
    console.warn("[checkout] no se pudieron reponer los datos del comprador");
  }, [controls]);

  const toggle = async (id: string, next: boolean) => {
    const nextAccepted = next
      ? accepted.includes(id)
        ? accepted
        : [...accepted, id]
      : accepted.filter((v) => v !== id);
    const remontaIframe = mustSaveCard(accepted) !== mustSaveCard(nextAccepted);

    // Antes de nada, copiar lo tecleado: en cuanto cambie el estado el iframe
    // se rehace y ya no hay a quién preguntárselo. Con un tope corto —si Whop
    // no contesta rápido, más vale seguir que dejar la casilla congelada—.
    if (remontaIframe && controls.current) {
      try {
        const [email, dir] = await Promise.all([
          controls.current.getEmail(1500).catch(() => ""),
          controls.current.getAddress(1500).catch(() => null),
        ]);
        tecleado.current = {
          email: email || undefined,
          address: dir?.address ?? undefined,
        };
        if (process.env.NODE_ENV === "development") {
          console.log("[checkout] copiado antes de rehacer:", tecleado.current);
        }
      } catch (e) {
        console.error("[checkout] no se pudo copiar lo tecleado", e);
        tecleado.current = null;
      }
    }
    // `includes` antes de añadir: esta función espera hasta 1,5s a que el
    // iframe suelte lo tecleado, y en ese rato la casilla sigue pintada como
    // estaba. Dos clics ahí dentro entraban los dos con `next: true` y dejaban
    // el id repetido en la lista —bump cobrado dos veces, total inflado—.
    setAccepted(nextAccepted);
    // Solo hay que tapar el formulario si cambia `setupFutureUsage`. En países
    // donde ya guardamos tarjeta, o después de haber marcado un bump, el iframe
    // sigue siendo el mismo y puede quedarse vivo.
    if (remontaIframe) {
      setPagoListo(false);
      setRecargando(true);
    }
    // El iframe NO se descuelga: la sesión de ahora ya cobra lo que toca —el
    // producto— y no viene ninguna nueva a sustituirla. Quitarlo dejaría el
    // cobro en blanco para siempre, porque nada volvería a montarlo.
  };

  const returned =
    returnedStatus === "error"
      ? "El pago no se completó. Puedes intentarlo de nuevo."
      : null;

  // --- Piezas ---------------------------------------------------------------

  const header = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        gap: narrow ? 20 : 28,
        // Los 12px que había acá eran para que la cinta del order bump no se
        // subiera hasta el titular. El bump ya no vive en esta columna, así que
        // solo separaban de más.
        marginBottom: narrow ? 0 : 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 15,
          fontWeight: 600,
          lineHeight: 1,
          color: C.tinta,
        }}
      >
        <BrandMark brand={brand} />
        <span>{brand.name}</span>
      </div>

      {/* Titular y precio en la misma línea, también en móvil. Si el nombre del
          producto no cabe junto al precio el `wrap` lo baja solo, sin tener que
          adivinar a partir de qué ancho pasa: el `flex-basis` de 180px es el
          mínimo con el que el titular se sigue leyendo en dos líneas. */}
      <div
        style={{
          display: narrow ? "flex" : "grid",
          gridTemplateColumns: narrow ? undefined : "minmax(0,1fr) auto",
          flexWrap: narrow ? "wrap" : undefined,
          alignItems: narrow ? "baseline" : "start",
          justifyContent: narrow ? "space-between" : undefined,
          columnGap: narrow ? 12 : 24,
          rowGap: narrow ? 6 : 24,
        }}
      >
        <h1
          style={{
            margin: 0,
            color: C.tinta,
            fontSize: narrow ? 22 : 34,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            ...(narrow ? { flex: "1 1 180px", minWidth: 0 } : {}),
          }}
        >
          {PRODUCT.name}
        </h1>
        <span
          style={{
            color: C.tintaSuave,
            fontSize: narrow ? 18 : 21,
            fontWeight: 500,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            paddingTop: narrow ? 0 : 5,
            flexShrink: 0,
          }}
        >
          {displayTotal(total.today, bumpsHoy)}
        </span>
      </div>
    </div>
  );

  const bumps = ORDER_BUMPS.length > 0 && (
    // `section-edge-to-edge`: por debajo de 1024px `globals.css` le mete 16px
    // de padding a toda <section> —es de la landing—, y acá eso estrecha la
    // tarjeta dentro de una columna que ya tiene su propio margen.
    <section
      className="section-edge-to-edge"
      style={{
        // El contenedor que consultan las `@container` de `globals.css`: lo que
        // manda es el ancho de esta columna, no el de la ventana. En el
        // checkout partido la ventana puede ser de escritorio y la columna
        // quedar más angosta que en un móvil.
        //
        // Va acá y no en la tarjeta porque una `@container` alcanza a los
        // descendientes del contenedor, nunca al contenedor mismo: puesta en la
        // tarjeta, sus propias variables no se aplicarían.
        containerType: "inline-size",
        containerName: "tarjeta-bump",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: "100%",
      }}
    >
      {/* Su rótulo, con el aire y el tamaño de los que pinta Whop justo encima
          —"Método de pago", "Número de teléfono"—, para que la tarjeta se lea
          como un paso más del formulario y no como algo pegado aparte. */}
      <span
        style={{
          color: C.text,
          fontSize: 14,
          fontWeight: 500,
          lineHeight: "20px",
        }}
      >
        Agrega a tu compra
      </span>
      {ORDER_BUMPS.map((bump) => {
        const price = pricing.bumps[bump.id];
        if (!price) return null;
        return (
          <BumpRow
            key={bump.id}
            bump={bump}
            price={price}
            compareAt={price.compareAt}
            checked={accepted.includes(bump.id)}
            onToggle={(next) => toggle(bump.id, next)}
            format={displayBump}
          />
        );
      })}
    </section>
  );

  // Va entre el titular y el order bump: los tres pasos que dibuja ("llena tus
  // datos, confirma, recibe acceso") sitúan al comprador en el paso 2, y eso se
  // lee mejor después de saber qué se compra y por cuánto.
  const heroBanner = (narrow: boolean) =>
    HERO && (
    <Image
      src={HERO.src}
      alt={HERO.alt}
      width={HERO.width}
      height={HERO.height}
      priority
      // Se sirve el archivo tal cual, sin pasar por el optimizador. El original
      // ya es un WebP de 62 KB, y optimizarlo lo bajaba a 640px y lo volvía a
      // comprimir a calidad 75: lossy sobre lossy, que en el titular dibujado y
      // en la cara se nota. Ahorraba ~27 KB a cambio de nitidez en la única
      // imagen que se ve nada más abrir, y encima queda a plena resolución en
      // pantallas Retina. La lateral sí se optimiza: ahí pesa medio mega.
      unoptimized
      sizes={`${CONTENT_ANCHO}px`}
      style={{
        width: "100%",
        height: "auto",
        borderRadius: 16,
        // En móvil el gap de la columna se quedaba corto contra el titular.
        marginTop: narrow ? 5 : 0,
      }}
    />
  );

  // La columna de venta, en el orden del diseño. Ninguna lleva `priority`:
  // están por debajo del pliegue y competir por ancho de banda con el cobro
  // sería pagar el arte con el formulario de pago. Van sin optimizar: el
  // compresor del optimizador de Next le restaba nitidez al arte dibujado, y
  // el diseño pide el archivo a su resolución completa.
  const laterales = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", gap: 28 }}>
      {LATERALES.map((img) => {
        const pieza = narrow && img.movil ? img.movil : img;
        return (
        <div key={img.src} style={img.margin ? { margin: img.margin } : undefined}>
          <Image
            src={pieza.src}
            alt={img.alt}
            width={pieza.width}
            height={pieza.height}
            unoptimized
            sizes={`${Math.round(img.ancho ?? CONTENT_ANCHO)}px`}
            style={{
              display: "block",
              width: img.ancho ?? "100%",
              height: "auto",
              borderRadius: 16,
            }}
          />
        </div>
        );
      })}
      {CARRUSEL_SLIDES.length > 0 && <SlideCarousel slides={CARRUSEL_SLIDES} />}
    </div>
  );

  /**
   * El loader, colgado de la columna del cobro y no de la caja del formulario:
   * esa caja empieza por debajo del padding de la columna, así que centrarlo
   * ahí lo dejaba por encima del centro que ve el ojo. Contra la columna sale
   * en mitad de la mitad blanca, y ni el aviso de error ni el sello de abajo
   * pueden moverlo de sitio.
   */
  const cargando = !pagoListo && !error && (
    <div
      style={{
        // Fijo a la ventana, no a la columna. Dentro de la columna era
        // `absolute` contra un contenedor con scroll propio: se quedaba a la
        // altura del formulario, así que al mirar el order bump —que vive más
        // abajo— no se veía nada, y encima el bump y el resumen se pintaban por
        // encima al venir después en el orden.
        //
        // Apilado ocupa la pantalla entera. Partido, solo la mitad del cobro:
        // la de la venta no se está rehaciendo y taparla sería gratuito. Esa
        // mitad siempre empieza en el centro de la ventana —la maqueta va
        // centrada—, y por la derecha llega hasta donde acabe, tope 1600 de
        // ancho total.
        //
        // Opaco a propósito: mientras el formulario se rehace, lo que hay
        // debajo es el del pedido anterior. Y se come los clics para que nadie
        // marque otra cosa a destiempo y abra un cobro que no es el que ve.
        position: "fixed",
        top: 0,
        bottom: 0,
        left: narrow ? 0 : "50vw",
        right: narrow ? 0 : `max(0px, calc(50vw - ${SPLIT_ANCHO / 2}px))`,
        display: "grid",
        placeItems: "center",
        background: "#FFFFFF",
        zIndex: 50,
      }}
    >
      <div style={{ display: "grid", justifyItems: "center", gap: 18 }}>
        <WhopLoadingMark size={narrow ? 82 : 96} color={C.cargandoGris} />
        <span
          style={{
            color: C.cargandoGris,
            fontSize: narrow ? 14 : 15,
            fontWeight: 500,
            lineHeight: "20px",
          }}
        >
          {recargando ? "Actualizando tu compra" : "Cargando el pago seguro"}
        </span>
      </div>
    </div>
  );

  /**
   * El botón de comprar, ya fuera del iframe.
   *
   * Va aquí, cerrando el pedido, y no dentro del formulario: es el gesto que
   * sigue a haber decidido qué se lleva, no a haber tecleado la tarjeta.
   *
   * Solo se enciende cuando Whop dice `ready`. Con `disabled` —falta el correo,
   * la tarjeta o la dirección— se queda apagado en vez de dejar que el
   * comprador lo pulse y no pase nada.
   */
  const botonComprar = (
    <button
      type="button"
      disabled={estadoPago !== "ready" || cobrando}
      onClick={async () => {
        if (!controls.current) return;
        setCobrando(true);
        setError(null);
        try {
          await controls.current.submit();
        } catch (e) {
          // Whop ya pinta dentro del iframe lo que falla de la tarjeta; esto es
          // para lo otro: que el propio envío no llegue a salir.
          console.error("[checkout] no se pudo enviar el pago", e);
          setError("No se pudo enviar el pago. Revisa los datos e intenta de nuevo.");
        } finally {
          setCobrando(false);
        }
      }}
      style={{
        width: "100%",
        height: 55,
        border: "none",
        borderRadius: 12,
        background: estadoPago === "ready" && !cobrando ? C.accent : "#C9CCD1",
        color: "#FFFFFF",
        fontFamily: "inherit",
        fontSize: 16,
        fontWeight: 500,
        cursor: estadoPago === "ready" && !cobrando ? "pointer" : "not-allowed",
        transition: "background 140ms ease",
      }}
    >
      {cobrando ? "Procesando…" : "Comprar ahora"}
    </button>
  );

  const line = (label: string, value: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%" }}>
      <span
        style={{
          color: C.tintaSuave,
          fontSize: "var(--resumen-linea, 15px)",
          fontWeight: 400,
          lineHeight: "21px",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: "#000000",
          fontSize: "var(--resumen-linea, 15px)",
          fontWeight: 600,
          lineHeight: "21px",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );

  // Sin tarjeta ni fondo: vive sobre el lienzo de la mitad izquierda y el
  // diseño lo quiere así, solo separado por la línea del total.
  const summary = (
    <section
      className="section-edge-to-edge checkout-resumen"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--resumen-gap, 14px)",
        paddingTop: 20,
        width: "100%",
      }}
    >
      <h3 style={{ color: "#000000", fontSize: 15, fontWeight: 600, lineHeight: "20px" }}>
        Tu pedido:
      </h3>

      {line(PRODUCT.name, display(pricing.mainToday))}

      {total.accepted.map((price) => {
        const bump = ORDER_BUMPS.find((b) => b.id === price.id);
        return (
          <div key={price.id}>
            {line(bump?.title ?? price.id, price.today > 0 ? displayBump(price.today) : "Gratis")}
          </div>
        );
      })}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          borderTop: "1px solid rgba(0,0,0,0.1)",
          paddingTop: 17,
          width: "100%",
        }}
      >
        <span
          style={{
            color: "#000000",
            fontSize: "var(--resumen-total, 15px)",
            fontWeight: 600,
            lineHeight: "22.5px",
          }}
        >
          Total hoy
        </span>
        <span
          style={{
            color: "#000000",
            fontSize: "var(--resumen-total, 15px)",
            // El mismo peso que el importe de cada línea: el total ya destaca
            // por la raya que lo separa, no hace falta cargarle la tinta.
            fontWeight: 600,
            lineHeight: "22.5px",
            whiteSpace: "nowrap",
          }}
        >
          {displayTotal(total.today, bumpsHoy)}
        </span>
      </div>

      {/* Su propio aire: el botón no es una línea más del resumen, es lo que
          viene después de haberlo leído. */}
      <div style={{ paddingTop: 8 }}>{botonComprar}</div>
    </section>
  );

  const aviso = (text: string, tone: "error" | "warn") => (
    <p
      style={{
        background: tone === "error" ? "#FFF1F0" : "#FFF8ED",
        border: `1px solid ${tone === "error" ? "#FFD5D2" : "#F3D7A5"}`,
        borderRadius: 12,
        color: tone === "error" ? C.danger : "#B76B00",
        fontSize: 13,
        lineHeight: 1.45,
        margin: 0,
        padding: "10px 12px",
      }}
    >
      {text}
    </p>
  );

  const payment = (
    <div
      style={{
        width: "100%",
        maxWidth: PAGO_ANCHO,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        color: C.text,
      }}
    >
      {returned && aviso(returned, "warn")}
      {mount ? (
        // El formulario no se enseña a medio montar. Whop pinta primero su
        // propio esqueleto gris y, mientras ajusta la altura del iframe, el
        // documento de dentro asoma un momento su barra de scroll —es suyo y
        // cross-origin, no hay CSS que le llegue—. Con esto lo único que se ve
        // es el loader hasta que el formulario está entero.
        //
        // `opacity` y no `display`: escondido con `display` el iframe no
        // cargaría ni se mediría, y nunca llegaría a estar listo.
        <div
          ref={raizPago}
          data-embed-pago={pagoListo ? "listo" : "cargando"}
          style={{
            position: "relative",
            // Recorta la firma de Whop del pie del iframe. El corte de verdad
            // lo hace este `overflow` contra el margen negativo que el iframe
            // lleva en `globals.css`: puesto acá, en el contenedor, el margen
            // solo subía lo que venía detrás y la franja seguía viéndose.
            overflow: "hidden",
            opacity: pagoListo ? 1 : 0,
            transition: "opacity 200ms ease",
            pointerEvents: pagoListo ? undefined : "none",
          }}
        >
        <WhopEmbed
          sessionId={mount.sessionId}
          planId={mount.planId}
          returnUrl={returnUrl}
          // Con un bump aceptado hay que guardar la tarjeta sí o sí: el bump se
          // cobra después contra ella. Whop retira PSE, Efecty y Bancolombia
          // cuando se pide —no dejan credencial reutilizable—, y es el precio
          // justo: sin tarjeta, ese bump no se podría cobrar y el comprador
          // pagaría un total que no recibe entero.
          saveCard={saveCard || planesAparte.length > 0}
          // El importe del iframe es solo el del producto: el que manda es el
          // del resumen, que suma las dos ventas.
          hidePrice
          fallback={<div style={{ minHeight: 420 }} aria-hidden="true" />}
          // El aviso legal lo pone la página, debajo, junto al sello.
          hideTermsAndConditions
          // Y el botón de comprar también: va debajo del pedido.
          hideSubmitButton
          controls={controls}
          onEstado={setEstadoPago}
          onDisplayCurrencyChange={onCurrency}
          onPaymentError={onPaymentError}
          onReady={() => {
            setPagoListo(true);
            reponerTecleado();
          }}
          accentColor={C.accent}
          // Con bump aceptado no se deja redirigir todavía: primero hay que
          // cobrar la segunda venta contra el método que dejó la compra.
          {...(planesAparte.length > 0 ? { onComplete: cobrarBumps } : {})}
        />
        </div>
      ) : (
        // Un hueco de la altura del formulario mientras Whop abre la sesión: sin
        // él, el resumen salta hacia arriba y la página parece romperse. Va
        // vacío a propósito —el loader flota aparte, centrado sobre toda la
        // caja del cobro— para que su posición no dependa de lo que mida esto.
        <div style={{ minHeight: 420 }} aria-hidden="true" />
      )}

      {error && aviso(error, "error")}

      {bumps}
      {summary}

      {/* El aviso legal, rehecho acá.
          El embed lo pintaba pegado al botón —`hideTermsAndConditions` lo
          quita— y quedaban dos pies de página seguidos: el suyo y el sello de
          compra segura. Ahora es uno solo.
          Los enlaces son los documentos de Whop, que es quien procesa el pago
          y a cuyos términos se adhiere el comprador. */}
      {pagoListo && (
        <p
          style={{
            color: C.tintaSuave,
            fontSize: 14,
            lineHeight: 1.45,
            textAlign: "center",
            // `balance` reparte el texto entre todas sus líneas, que en una
            // columna ancha queda bien. En móvil son ya cinco o seis líneas y
            // repartirlas todas las deja cortas y desiguales: `pretty` solo se
            // ocupa de que la última no quede suelta con dos palabras.
            textWrap: narrow ? "pretty" : "balance",
            // `margin` antes que `marginInline`: al revés, el atajo lo pisaría
            // y el párrafo dejaría de centrarse dentro de sus 400px.
            margin: 0,
            maxWidth: narrow ? 400 : undefined,
            marginInline: narrow ? "auto" : undefined,
          }}
        >
          Al realizar la compra, aceptas los{" "}
          <a href={LEGAL.terminos} target="_blank" rel="noopener noreferrer" style={ENLACE_LEGAL}>
            Términos de servicio
          </a>
          ,{" "}
          <a href={LEGAL.privacidad} target="_blank" rel="noopener noreferrer" style={ENLACE_LEGAL}>
            Política de privacidad
          </a>
          , Política de devoluciones y EULA de {brand.name}.
        </p>
      )}

      {/* Sin la tira de logos de `formas-de-pago.svg`: está dibujada en blanco
          para el fondo oscuro del embudo y sobre esta mitad no se ve nada. Los
          métodos que de verdad puede usar este comprador los lista el propio
          embed, ya filtrados por su país. Cotejado contra Figma (nodo
          2394:7343): el logo de Whop, un separador y "Compra 100% segura".
          Solo con el formulario ya montado —`ready` del propio embed, no la
          sesión abierta—: mientras se prepara, el loader ya está diciendo lo
          mismo, y las dos cosas juntas se pisan. */}
      {pagoListo && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          {/* 78.8 = 90 × 14/16: el logo baja en la misma proporción que el texto
              que lo acompaña, para que el par siga leyéndose como una pieza. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/svg/whop-logo.svg" alt="Whop" width={78.8} height={17.3} style={{ display: "block" }} />
          <span aria-hidden="true" style={{ width: 1, height: 16, background: "#373737", flexShrink: 0 }} />
          <span style={{ color: "#373737", fontSize: 14, fontWeight: 600, lineHeight: "16.4px", whiteSpace: "nowrap" }}>
            Compra 100% segura
          </span>
        </div>
      )}
    </div>
  );

  const content = (narrow: boolean) => (
    <div
      style={{
        width: "100%",
        maxWidth: CONTENT_ANCHO,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        // Lo que no pide todo el ancho —el sello de garantía, que mide 429—
        // queda centrado en la columna en vez de pegado a la izquierda.
        alignItems: "center",
        gap: narrow ? 18 : 28,
      }}
    >
      {header}
      {heroBanner(narrow)}
      {/* Ni el bump ni el resumen van acá: los dos viven ahora en la columna
          del cobro, debajo del formulario. Es donde cierran el gesto —elegir
          qué te llevas y pulsar comprar— en vez de quedarse al otro lado de la
          pantalla, separados del botón que los remata. */}
      {/* En móvil los banners no van acá: bajan detrás del cobro, para que el
          formulario esté a un scroll corto y no al final de toda la venta. */}
      {!narrow && laterales}
    </div>
  );

  // Apilado: en un móvil las dos mitades pasan a ser dos franjas, el contenido
  // arriba y el cobro debajo, ese sí a todo el ancho y sobre blanco.
  if (narrow) {
    return (
      <div
        style={{
          fontFamily: FUENTE,
            color: C.tinta,
          display: "flex",
          flexDirection: "column",
          minHeight: "100dvh",
          background: C.lienzo,
        }}
      >
        {/* Menos aire arriba que en escritorio: en un móvil esos 48px eran media
            pantalla antes de llegar al nombre del producto. Y en blanco, no
            sobre el lienzo: apilado, esta franja y la del cobro van seguidas y
            el cambio de fondo entre las dos partía la pantalla en dos por un
            corte que no significa nada. */}
        {/* Sin suelo: lo que viene justo debajo es la franja del cobro, también
            blanca, así que el aire de las dos se sumaba en un hueco que no
            separaba nada. */}
        <div style={{ background: "#FFFFFF", padding: "24px 20px 0" }}>{content(true)}</div>
        <div style={{ position: "relative", background: "#FFFFFF", padding: "36px 20px 56px" }}>
          {payment}
          {cargando}
        </div>
        {/* La venta larga, detrás del cobro y sobre el mismo lienzo que la
            cabecera: se lee como otra sección, no como una segunda página. */}
        <div style={{ flex: 1, background: C.lienzo, padding: "40px 20px 56px" }}>
          {laterales}
        </div>
      </div>
    );
  }

  // La página, partida por la mitad: el contenido de un lado y el cobro del
  // otro, cada mitad con su fondo de arriba abajo.
  //
  // Y cada mitad con su propio scroll, encerradas en una pantalla exacta. La
  // columna de venta mide varios miles de píxeles y el cobro apenas uno: con un
  // solo scroll, o el formulario se queda atrás o hay que clavarlo, y clavado se
  // veía raro. Así cada lado va a su ritmo y ninguno arrastra al otro.
  // Las barras se esconden en `globals.css` (`.checkout-pane`), y el `:has` de
  // `.checkout-split` es lo que además le quita el scroll a la página entera.
  return (
    <div
      className="checkout-split"
      style={{
        fontFamily: FUENTE,
        color: C.tinta,
        display: "flex",
        justifyContent: "center",
        height: "100dvh",
        overflow: "hidden",
        background: `linear-gradient(90deg, ${C.lienzo} 0 50%, #FFFFFF 50% 100%)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          width: "100%",
          maxWidth: SPLIT_ANCHO,
          height: "100%",
        }}
      >
        {/* `minHeight: 0` no es decorativo: sin él un hijo flex se niega a
            encogerse por debajo de su contenido y el `overflow-y` nunca llega a
            activarse —la columna crecería y se saldría de la pantalla—. */}
        <div
          className="checkout-pane"
          style={{ flex: "1 1 50%", minWidth: 0, minHeight: 0, padding: PANE_PADDING }}
        >
          {content(false)}
        </div>
        {/* La mitad blanca empuja el cobro hacia la izquierda en pantallas
            grandes: centrado dentro de media pantalla se va demasiado lejos. */}
        <div
          className="checkout-pane"
          style={{
            flex: "1 1 50%",
            minWidth: 0,
            minHeight: 0,
            background: "#FFFFFF",
            // Mismo criterio que la otra mitad —padding igual a los lados y el
            // contenido centrado dentro—, con algo más de aire arriba. Antes
            // llevaba un `clamp(40px, 18%, 150px)` a la izquierda para empujar
            // el cobro hacia el centro, pero eso lo desligaba del viewport y a
            // anchos medios se notaba el desajuste.
            padding: PANE_PADDING_COBRO,
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          {payment}
          {cargando}
        </div>
      </div>
    </div>
  );
}
