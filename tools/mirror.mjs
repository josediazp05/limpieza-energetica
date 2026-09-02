// Baja las páginas del embudo y las deja servibles desde este proyecto.
//
// El HTML de cada una queda en public/paginas/<slug>.html y todo lo que pide
// —CSS, imágenes, fuentes, y lo que esos CSS piden a su vez— en
// public/assets/<tipo>/. Las URLs quedan reescritas a rutas locales, así que la
// copia no depende del sitio original ni de que siga publicado.
//
// `public/` se llama así porque es el nombre que Next exige para los estáticos;
// dentro va todo ordenado por tipo. El nombre de cada archivo lleva el hash de
// su URL, así que las dos VSL —que comparten casi todo el arte de marca— se
// bajan una sola vez.
//
// La reescritura va en dos pasadas —primero se decide y se baja, después se
// sustituye— porque sustituir sobre la marcha corre los índices del resto de
// coincidencias y deja atrás la mitad de los activos.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

// El slug es el paso del embudo, no el subdominio de donde sale la página.
//
// Y en los downsell NO coinciden: dw1.cristinalozano vende Introducción a 28 €
// y dw2.cristinalozano vende Maldiciones a 33 €, o sea al revés de lo que pide
// el embudo. El downsell 1 cuelga del "no quiero" del upsell 1 —Maldiciones a
// 67 €—, así que tiene que ser el de Maldiciones a mitad de precio; y el
// downsell 2 cuelga del upsell 2 —Introducción a 57 €—, así que es el de
// Introducción a 28 €. Se bajan cruzados a propósito: manda el producto que
// vende cada página, no el nombre del subdominio.
const PAGINAS = [
  ["vsl-limpiezas", "https://cristinalozano-constelaciones.com/vsl-limpiezas-energeticas-2026/"],
  ["vsl-maldiciones", "https://cristinalozano-constelaciones.com/vsl-maldiciones-familiares-2026/"],
  ["up1", "https://up1.cristinalozano-constelaciones.com/"],
  ["up2", "https://up2.cristinalozano-constelaciones.com/"],
  ["dw1", "https://dw2.cristinalozano-constelaciones.com/"],
  ["dw2", "https://dw1.cristinalozano-constelaciones.com/"],
  ["gracias", "https://graciaseml.cristinalozano-constelaciones.com/"],
];

const PROYECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLICO = path.join(PROYECTO, "public");

/** En qué carpeta de public/assets cae cada archivo, por su extensión. */
const CARPETAS = {
  images: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp"],
  svg: [".svg"],
  fonts: [".woff", ".woff2", ".ttf", ".otf", ".eot"],
  css: [".css"],
  js: [".js", ".mjs", ".json", ".map"],
};

function carpetaDe(ext, tipo) {
  const e = ext.toLowerCase();
  for (const [carpeta, exts] of Object.entries(CARPETAS)) if (exts.includes(e)) return carpeta;
  // Sin extensión útil —los CDN sirven de todo desde rutas sin punto— manda el
  // content-type: si no, todo lo raro acabaría mezclado con las imágenes.
  if (tipo.startsWith("image/svg")) return "svg";
  if (tipo.startsWith("image/")) return "images";
  if (tipo.startsWith("font/") || tipo.includes("font")) return "fonts";
  if (tipo.includes("css")) return "css";
  if (tipo.includes("javascript") || tipo.includes("json")) return "js";
  return "otros";
}

/** Extensión canónica para lo que llega sin ella en la URL. */
const EXT_POR_TIPO = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "text/css": ".css",
  "application/javascript": ".js",
  "text/javascript": ".js",
  "font/woff2": ".woff2",
  "font/woff": ".woff",
  "font/ttf": ".ttf",
};

// Google Fonts se queda remoto: sirve un CSS distinto según el navegador, así
// que bajarlo congelaría el de este.
const REMOTO = (u) =>
  u.startsWith("https://fonts.googleapis.com") || u.startsWith("https://fonts.gstatic.com");

async function bajar(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const tipo = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  return { buf: Buffer.from(await res.arrayBuffer()), tipo };
}

/**
 * El almacén de activos: uno para todo el mirror, para que un archivo que usan
 * dos páginas se baje —y se guarde— una sola vez.
 */
class Almacen {
  constructor() {
    this.hechos = new Map(); // url absoluta -> ruta pública (o null si no se pudo)
  }

  get bajados() {
    return [...this.hechos.values()].filter(Boolean).length;
  }

  nombre(url, ext) {
    const base = path.basename(new URL(url).pathname) || "asset";
    const propia = path.extname(base);
    const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
    const limpio = base
      .slice(0, propia ? -propia.length : undefined)
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return `${limpio || "asset"}-${hash}${ext}`;
  }

  // Ruta pública con la que sustituir esta URL, bajando el archivo la primera
  // vez que aparece. `null` = déjala como está.
  async activo(url, desde) {
    let abs;
    try {
      abs = new URL(url, desde).href;
    } catch {
      return null;
    }
    if (!/^https?:/.test(abs) || REMOTO(abs)) return null;
    if (this.hechos.has(abs)) return this.hechos.get(abs);
    this.hechos.set(abs, null); // corta los ciclos entre CSS mientras se baja

    let datos;
    try {
      datos = await bajar(abs);
    } catch (err) {
      console.warn(`  ! ${err.message}`);
      return null;
    }

    const ext = path.extname(new URL(abs).pathname) || EXT_POR_TIPO[datos.tipo] || "";
    const carpeta = carpetaDe(ext, datos.tipo);
    const nombre = this.nombre(abs, ext);
    const destino = `/assets/${carpeta}/${nombre}`;
    this.hechos.set(abs, destino);

    // Un CSS puede pedir fuentes e imágenes: se reescribe igual que el HTML.
    const cuerpo =
      carpeta === "css" ? Buffer.from(await this.css(datos.buf.toString("utf8"), abs)) : datos.buf;

    await mkdir(path.join(PUBLICO, "assets", carpeta), { recursive: true });
    await writeFile(path.join(PUBLICO, "assets", carpeta, nombre), cuerpo);
    return destino;
  }

  async css(texto, base) {
    const mapa = new Map();
    for (const ref of texto.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      const cruda = ref[2].trim();
      if (cruda.startsWith("data:") || cruda.startsWith("#") || mapa.has(ref[0])) continue;
      const local = await this.activo(cruda, base);
      if (local) mapa.set(ref[0], `url("${local}")`);
    }
    return texto.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m) => mapa.get(m) ?? m);
  }

  // srcset lleva varias URLs con su descriptor: "a.png 300w, b.png 768w".
  async srcset(valor, base) {
    const partes = [];
    for (const parte of valor.split(",")) {
      const trozos = parte.trim().split(/\s+/);
      if (!trozos[0]) continue;
      const local = await this.activo(trozos[0], base);
      partes.push([local ?? trozos[0], ...trozos.slice(1)].join(" "));
    }
    return partes.join(", ");
  }
}

// Un `href` dentro de un <a> es navegación, no un activo. Igual los <link> de
// metadatos (canonical, feeds, oembed) y las pistas de red (preconnect).
const ATTR = /\b(href|src|data-src|poster)\s*=\s*(['"])([^'"]*)\2/gi;
const ES_NAVEGACION = /<a\b[^>]*$/i;
const ES_META =
  /<link\b[^>]*\brel=(['"])(canonical|alternate|shortlink|next|prev|pingback|EditURI|https:\/\/api\.w\.org\/|preconnect|dns-prefetch|profile)\1[^>]*$/i;

/**
 * Los tramos del documento que son JavaScript, no marcado.
 *
 * Dentro de un <script> hay cosas que se leen igual que un atributo —
 * `avatar.src="https://randomuser.me/api/portraits/women/"`, que además se
 * concatena con el número de la foto— y reescribirlas rompe el script sin que
 * salte nada: la página carga y el avatar sale roto.
 */
function tramosDeScript(html) {
  const tramos = [];
  for (const m of html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)) {
    // Solo el cuerpo: el `src` de la etiqueta de apertura sí es un activo.
    const cuerpo = m.index + m[1].length;
    tramos.push([cuerpo, cuerpo + m[2].length]);
  }
  return tramos;
}

const dentroDe = (tramos, i) => tramos.some(([a, b]) => i >= a && i < b);

async function mirror(almacen, slug, url) {
  console.log(`\n=== ${slug} ← ${url}`);
  const { buf } = await bajar(url);
  const original = buf.toString("utf8");
  const scripts = tramosDeScript(original);

  // Pasada 1: decidir y bajar, apuntando cada sustitución por posición.
  const cambios = []; // { desde, hasta, texto }

  for (const est of original.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const nuevo = await almacen.css(est[1], url);
    if (nuevo !== est[1]) {
      const desde = est.index + est[0].indexOf(est[1]);
      cambios.push({ desde, hasta: desde + est[1].length, texto: nuevo });
    }
  }

  for (const a of original.matchAll(ATTR)) {
    const valor = a[3].trim();
    if (!valor || valor.startsWith("#") || valor.startsWith("data:") || valor.startsWith("mailto:")) continue;
    if (dentroDe(scripts, a.index)) continue;
    const antes = original.slice(Math.max(0, a.index - 400), a.index);
    if (ES_NAVEGACION.test(antes) || ES_META.test(antes)) continue;
    const local = await almacen.activo(valor, url);
    if (local) cambios.push({ desde: a.index, hasta: a.index + a[0].length, texto: `${a[1]}="${local}"` });
  }

  for (const s of original.matchAll(/\bsrcset\s*=\s*(['"])([^'"]*)\1/gi)) {
    const nuevo = await almacen.srcset(s[2], url);
    if (nuevo && nuevo !== s[2]) {
      cambios.push({ desde: s.index, hasta: s.index + s[0].length, texto: `srcset="${nuevo}"` });
    }
  }

  // Pasada 2: aplicar de atrás hacia delante, para no correr los índices.
  cambios.sort((a, b) => b.desde - a.desde);
  let html = original;
  for (const c of cambios) html = html.slice(0, c.desde) + c.texto + html.slice(c.hasta);

  await mkdir(path.join(PUBLICO, "paginas"), { recursive: true });
  await writeFile(path.join(PUBLICO, "paginas", `${slug}.html`), html);
  console.log(`  ${cambios.length} referencias → public/paginas/${slug}.html`);
}

const almacen = new Almacen();
for (const [slug, url] of PAGINAS) await mirror(almacen, slug, url);
console.log(`\n${almacen.bajados} activos en public/assets/`);
