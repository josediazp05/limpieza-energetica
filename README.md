# Limpiezas Energéticas — embudo Whop

Checkout propio y endpoints del embudo para la VSL de **Maldiciones Familiares**
de Cristina Lozano. Mismo esqueleto que `kevin-mvp`: Next 16 + Tailwind 4 +
pnpm, checkout de Whop embebido y cobro de un clic para upsells y downsells.

Las **páginas de venta no viven acá**: son las de
`cristinalozano-constelaciones.com`. Lo que vive acá es el único sitio donde el
comprador mete la tarjeta (`/checkout`) y los saltos entre páginas que cobran
(`/f/<paso>/<respuesta>`).

## Cómo se ata el embudo

Cada botón de las páginas externas apunta a un endpoint de este sitio, **no** a
la página siguiente. Ese salto es el cobro: si "SÍ QUIERO" fuera un enlace
directo al upsell 2, nadie habría cobrado el upsell 1.

| Página             | Botón        | A dónde apunta                       |
| ------------------ | ------------ | ------------------------------------ |
| VSL                | INICIO / CTA | `https://<sitio>/checkout`           |
| UPSELL 1           | SÍ QUIERO    | `https://<sitio>/f/up1/si`           |
| UPSELL 1           | NO QUIERO    | `https://<sitio>/f/up1/no`           |
| DOWNSELL 1         | SÍ QUIERO    | `https://<sitio>/f/dw1/si`           |
| DOWNSELL 1         | NO QUIERO    | `https://<sitio>/f/dw1/no`           |
| UPSELL 2           | SÍ QUIERO    | `https://<sitio>/f/up2/si`           |
| UPSELL 2           | NO QUIERO    | `https://<sitio>/f/up2/no`           |
| DOWNSELL 2         | SÍ QUIERO    | `https://<sitio>/f/dw2/si`           |
| DOWNSELL 2         | NO QUIERO    | `https://<sitio>/f/dw2/no`           |
| COMBO 2X1          | SÍ / NO      | `https://<sitio>/f/combo/si` \| `/no`|

El recorrido que sale de ahí es el del constructor:

```
VSL → /checkout → UP1 ─sí→ UP2 ─sí→ GRACIAS
                       │          └no→ DW2 ─sí/no→ GRACIAS
                       └no→ DW1 ─sí→ UP2
                                 └no→ COMBO 2X1 ─sí/no→ GRACIAS
```

Se cambia en `app/(funnel)/funnel.ts`, que es donde están el orden, las URLs y
qué plan cobra cada paso. No hay ningún otro sitio donde esté escrito.

### Qué hace cada respuesta

- **`si`** — cobra el plan del paso contra la tarjeta guardada del checkout
  inicial (`lib/one-click.ts`) y solo entonces redirige. Si no hay tarjeta que
  cobrar —quien pagó por PSE, Nequi, Efecty o Pix no dejó ninguna— la oferta no
  se pierde: va al checkout hosteado de Whop de ese mismo plan, que acepta todos
  los métodos y vuelve por `hecho`.
- **`no`** — no cobra nada y pasa al siguiente del embudo.
- **`hecho`** — no lo pulsa nadie: es la vuelta desde el checkout hosteado.
  Significa "esto ya está pagado, sigue", y no vuelve a cobrar.

Cobrar dos veces es imposible por construcción: cada cobro va con una
`Idempotency-Key` hecha del pago y el plan, así que un doble clic, un reintento
de red o una vuelta atrás del navegador reciben la respuesta del primer cobro
sin mover dinero.

### De quién es la tarjeta

Por orden: el `payment_id` de la URL, la cookie `whop_pay`, y si no, se le
pregunta a Whop por la checkout configuration del visitante (cookie
`whop_ccfg`). Las cookies son `SameSite=Lax` y los `/f/...` se visitan como
navegación de primer nivel, así que viajan aunque el enlace venga de otro
dominio. El `payment_id` se reenvía además en la URL de cada página del embudo,
por si el comprador cambia de navegador a mitad del recorrido.

## Puesta en marcha

```bash
pnpm install
cp .env.example .env.local   # y rellenar
pnpm dev
```

Hace falta como mínimo `WHOP_API_KEY`, `WHOP_COMPANY_ID` y `WHOP_PLAN_MAIN`
para que el checkout cobre, más un `WHOP_PLAN_*` por cada upsell y downsell.
**Un paso sin plan configurado no cobra**: deja pasar al comprador y lo apunta
en el log, que es preferible a dejarlo atascado después de haber dicho que sí.

`NEXT_PUBLIC_SITE_URL` tiene que ser https: Whop rechaza cualquier otra cosa
como `redirect_url`, así que en local hay que apuntar al dominio real o a un
túnel.

## Lo que falta

- **La URL del COMBO 2X1.** Es el único paso del constructor sin página
  publicada. Mientras `FUNNEL_COMBO_URL` esté vacía, el "no quiero" del
  downsell 1 cae directo a la página de gracias.
- **Los ids de plan de Whop** de cada paso (`.env.local`).
- **El arte del checkout** (`ARTE` en `app/(funnel)/checkout/constants.ts`): la
  pieza de arriba, las laterales y el carrusel de testimonios. Sin ellas la
  columna de venta se queda con el titular, el resumen y el cobro, que es lo
  que de verdad cobra.

## Estructura

```
app/(funnel)/
  funnel.ts                  el embudo: orden, URLs y plan de cada paso
  f/[paso]/[respuesta]/      el endpoint que cobra y salta al paso siguiente
  checkout/                  el checkout embebido de Whop (la maqueta)
  api/whop/session/          abre y rehace la sesión de cobro
  api/whop/charge/           cobro de un clic como JSON, para botones propios
  api/whop/checkout/         checkout hosteado de Whop (el rescate del one-click)
  api/whop/webhook/          la venta confirmada → Meta CAPI
lib/
  one-click.ts               cobrar la tarjeta guardada, con idempotencia
  whop.ts                    leer planes y abrir sesiones
  sesion-checkout.ts         el pedido: precio, metadata de atribución y sesión
```
