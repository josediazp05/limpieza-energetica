// Pasa las páginas bajadas por tools/mirror.mjs del embudo viejo al de Whop.
//
// Lo que hace, sobre public/paginas/*.html:
//
//  1. Quita la instrumentación del embudo anterior —Hotmart, los píxeles de vk,
//     Clarity, el fbq de la cuenta vieja, la analítica de Lovable—. No es
//     limpieza estética: son scripts que siguen reportando a paneles ajenos a
//     esta cuenta, y el píxel de Meta de este embudo lo pone el servidor con el
//     id de .env.local, en app/(funnel)/paginas/[slug]/route.ts.
//  2. Quita la hidratación de Lovable. Las páginas son React servidas ya
//     renderizadas, pero su router solo conoce "/" y aquí viven en /p/<slug>;
//     al hidratar borrarían la página. Sin ella no se pierde nada: todo lo que
//     se mueve —el brillo, la marquesina de testimonios, las estrellas— es CSS.
//  3. Convierte los CTAs internos de las ofertas en enlaces directos del
//     embudo: /f/<paso>/si intenta cobrar one-click y, si Whop no puede, cae al
//     checkout normal. El "NO QUIERO" queda como link simple a /f/<paso>/no.
//
// Es idempotente: se puede volver a correr sobre una página ya tratada.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROYECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGINAS = path.join(PROYECTO, "public", "paginas");

/**
 * Qué vende cada página y con qué texto. El texto del "sí" también sirve para
 * ubicar el CTA principal donde va el rechazo visual.
 */
const OFERTAS = {
  up1: { paso: "up1", si: "Sí, quiero romper el ciclo ahora", no: "No, gracias. Prefiero seguir sin esta oferta" },
  up2: { paso: "up2", si: "¡Sí, quiero el mapa completo!", no: "No, gracias. Prefiero seguir sin esta oferta" },
  dw1: { paso: "dw1", si: "Sí, quiero romper el ciclo a mitad de precio", no: "No, gracias. Entiendo que esta oferta no vuelve" },
  dw2: { paso: "dw2", si: "Sí, quiero entrar a mitad de precio", no: "No, gracias. Entiendo que esta oferta no vuelve" },
  combo: { paso: "combo", si: "Sí, quiero los dos programas", no: "No, gracias. Prefiero seguir sin el combo" },
};

/** Las VSL no venden con botón propio: mandan al checkout de este sitio. */
const VSL = {
  "vsl-limpiezas": "Quiero mi Limpieza Energética",
  "vsl-maldiciones": "Quiero romper la maldición familiar",
};

// ---------------------------------------------------------------------------
// Recortar bloques del HTML

/**
 * Dónde acaba el elemento que empieza en `desde`, contando anidamientos.
 *
 * Hace falta contar: los `<div>` de estas páginas están anidados diez niveles,
 * así que "hasta el próximo `</div>`" cerraría por dentro y partiría la página.
 */
function finDelElemento(html, desde, etiqueta) {
  const abre = new RegExp(`<${etiqueta}\\b`, "gi");
  const cierra = new RegExp(`</${etiqueta}\\s*>`, "gi");
  let nivel = 0;
  let i = desde;
  while (i < html.length) {
    abre.lastIndex = i;
    cierra.lastIndex = i;
    const a = abre.exec(html);
    const c = cierra.exec(html);
    if (!c) return -1;
    if (a && a.index < c.index) {
      nivel += 1;
      i = a.index + 1;
    } else {
      nivel -= 1;
      i = c.index + 1;
      if (nivel === 0) return c.index + c[0].length;
    }
  }
  return -1;
}

/** Quita todos los elementos `etiqueta` cuyo texto completo cumpla `sobra`. */
function quitar(html, etiqueta, sobra) {
  let salida = "";
  let i = 0;
  const inicio = new RegExp(`<${etiqueta}\\b`, "gi");
  while (true) {
    inicio.lastIndex = i;
    const m = inicio.exec(html);
    if (!m) break;
    const fin = finDelElemento(html, m.index, etiqueta);
    if (fin === -1) break;
    const bloque = html.slice(m.index, fin);
    salida += html.slice(i, m.index);
    if (!sobra(bloque)) salida += bloque;
    i = fin;
  }
  return salida + html.slice(i);
}

/** Quita el elemento que contiene `texto`, subiendo hasta su `<div` más cercano. */
function quitarBloqueCon(html, texto) {
  const donde = html.indexOf(texto);
  if (donde === -1) return html;
  const arranque = html.lastIndexOf("<div", donde);
  if (arranque === -1) return html;
  const fin = finDelElemento(html, arranque, "div");
  if (fin === -1) return html;
  return html.slice(0, arranque) + html.slice(fin);
}

// ---------------------------------------------------------------------------
// La instrumentación que se va

const SOBRA_SCRIPT = [
  /clarity\.ms/i, // Microsoft Clarity
  /vkPixelSales|vkdigital/i, // píxel de ventas de vk
  /connect\.facebook\.net|facebook\.com\/tr|fbq\s*\(/i, // píxel de Meta de la cuenta vieja
  /window\.pixelId\s*=/i, // utmify
  /\$_TSR|tsr-scroll-restoration/i, // hidratación de TanStack Router (Lovable)
  /\/assets\/js\/flock-/i, // analítica de Lovable
  /external-tracking/i, // seguimiento de GoHighLevel
  /hotmart/i, // el widget del embudo anterior
  /\/assets\/js\/index-[A-Za-z0-9_-]+\.js/i, // el bundle de Lovable
];

function limpiar(html) {
  let out = quitar(html, "script", (b) => SOBRA_SCRIPT.some((re) => re.test(b)));
  // El <noscript> del píxel viejo: una imagen de 1x1 a facebook.com/tr, que
  // tools/mirror.mjs ya habrá bajado a /assets/ con el resto.
  out = quitar(out, "noscript", (b) => /facebook\.com\/tr|\/assets\/\w+\/tr-/i.test(b));
  // modulepreload: sin bundle que precargar, es una petición a un 404.
  out = out.replace(/<link\b[^>]*rel=(['"])modulepreload\1[^>]*>\s*/gi, "");
  // El marcador de streaming de React, ya sin nada que hidratar.
  out = out.replace(/<!--\/?\$-->/g, "");
  return out;
}

// ---------------------------------------------------------------------------
// Los botones del embudo

function marcarSi(tag) {
  if (/\bdata-embudo=/.test(tag)) return tag;
  return tag.replace(/^<a\b/i, '<a data-embudo="si"');
}

function convertirCtasOferta(html, oferta) {
  return html.replace(/<a\b([^>]*?)href=(['"])#[A-Za-z0-9_-]+\2([^>]*)>/gi, (_tag, antes, comilla, despues) =>
    marcarSi(`<a${antes}href=${comilla}/f/${oferta.paso}/si${comilla}${despues}>`),
  );
}

function quitarSeccionHotmart(html) {
  const marca = html.search(/<div\b[^>]*id=(['"])hotmart-sales-funnel\1/i);
  if (marca === -1) return html;

  const seccion = html.lastIndexOf("<section", marca);
  if (seccion !== -1) {
    const finSeccion = finDelElemento(html, seccion, "section");
    if (finSeccion !== -1 && finSeccion > marca) {
      return html.slice(0, seccion) + html.slice(finSeccion);
    }
  }

  const contenedor = html.lastIndexOf("<div", marca);
  const finContenedor = finDelElemento(html, contenedor, "div");
  if (contenedor === -1 || finContenedor === -1) return html;
  return html.slice(0, contenedor) + html.slice(finContenedor);
}

function textoPlano(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function rechazo(oferta) {
  return (
    `<div data-embudo="rechazo" style="display:flex;justify-content:center;margin-top:.95rem;padding:0 1rem">` +
    `<a data-embudo="no" href="/f/${oferta.paso}/no" ` +
    `style="font-size:.875rem;line-height:1.45;text-align:center;color:var(--muted-foreground);` +
    `text-decoration:underline;text-underline-offset:4px;opacity:.9">${oferta.no}</a>` +
    `</div>`
  );
}

function insertarRechazo(html, oferta) {
  if (html.includes('data-embudo="rechazo"')) return html;

  const enlaces = [...html.matchAll(new RegExp(`<a\\b[^>]*href=(['"])/f/${oferta.paso}/si\\1[^>]*>.*?</a>`, "gis"))];
  const principal = enlaces.find((m) => textoPlano(m[0]).includes(oferta.si)) ?? enlaces[0];
  if (!principal) throw new Error(`no hay CTA directo para /f/${oferta.paso}/si`);

  const fin = principal.index + principal[0].length;
  return html.slice(0, fin) + rechazo(oferta) + html.slice(fin);
}

function prepararOferta(html, oferta) {
  let out = quitarBloqueCon(html, "Cargando checkout seguro");
  out = convertirCtasOferta(out, oferta);
  out = quitarSeccionHotmart(out);
  out = insertarRechazo(out, oferta);
  out = quitarBloqueCon(out, "Cargando checkout seguro");
  return out;
}

/**
 * El CTA de las VSL.
 *
 * Estas páginas no traían ninguno: el botón de comprar lo pintaba el reproductor
 * de converteai encima del vídeo, con el enlace configurado en su panel. Ese
 * enlace no se puede cambiar desde acá, así que la página necesita un botón
 * propio al checkout o no hay forma de entrar al embudo.
 */
function ctaVsl(html, texto) {
  if (html.includes('data-embudo="vsl"')) return html; // ya puesto
  const player = html.indexOf("<vturb-smartplayer");
  if (player === -1) throw new Error("no está el reproductor de la VSL");
  const contenedor = html.lastIndexOf("<div", player);
  const fin = finDelElemento(html, contenedor, "div");
  const boton =
    `<div data-embudo="vsl" style="display:flex;justify-content:center;padding:1.5rem 1rem 0">` +
    `<a href="/checkout" style="display:inline-flex;align-items:center;justify-content:center;gap:.75rem;` +
    `max-width:34rem;width:100%;padding:1.05rem 2rem;border-radius:999px;background:linear-gradient(135deg,#c8a24a,#f0d896 55%,#b8862f);` +
    `color:#3a2415;font-family:Montserrat,system-ui,sans-serif;font-weight:800;font-size:1.05rem;letter-spacing:.02em;` +
    `text-align:center;text-decoration:none;box-shadow:0 10px 30px rgba(184,134,47,.35)">${texto}</a></div>`;
  return html.slice(0, fin) + boton + html.slice(fin);
}

// ---------------------------------------------------------------------------

async function tratar(slug) {
  const archivo = path.join(PAGINAS, `${slug}.html`);
  const antes = await readFile(archivo, "utf8");
  let html = limpiar(antes);

  if (OFERTAS[slug]) html = prepararOferta(html, OFERTAS[slug]);
  if (VSL[slug]) html = ctaVsl(html, VSL[slug]);

  await writeFile(archivo, html);
  const ahorro = antes.length - html.length;
  console.log(`${slug.padEnd(16)} ${ahorro >= 0 ? "-" : "+"}${Math.abs(ahorro)} bytes`);
}

const slugs = process.argv.slice(2);
for (const slug of slugs.length
  ? slugs
  : ["vsl-limpiezas", "vsl-maldiciones", "up1", "dw1", "up2", "dw2", "combo", "gracias"]) {
  try {
    await tratar(slug);
  } catch (err) {
    console.error(`${slug.padEnd(16)} ! ${err.message}`);
  }
}
