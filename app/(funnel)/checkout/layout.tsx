/**
 * Inter ya no se sirve como archivo local. Mantener la variable evita que los
 * estilos inline de la vista queden inválidos y deja que el navegador use Inter
 * si está disponible, o el sans-serif del sistema.
 */
const checkoutFontVars = {
  "--font-inter": "Inter, sans-serif",
} as React.CSSProperties;

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={checkoutFontVars}>
      {/* El formulario de pago es un iframe de whop.com que no se pide hasta
          que la sesión está abierta —unos 400ms después de cargar la página—.
          Adelantando el DNS y el TLS ahora, cuando llegue ese momento la
          conexión ya está hecha y el iframe empieza a bajar de inmediato.
          React 19 los sube solo al `<head>`.

          Son los tres hosts que toca el navegador al abrir el checkout:
          `whop.com` sirve el documento del iframe y sus 76 chunks de JS,
          `content.whop.com` los iconos de los métodos de pago e
          `img-v2-prod` las imágenes del producto.

          `api.whop.com` NO va acá: a esa la llama nuestro servidor desde Node
          para abrir la sesión, y el navegador no la toca nunca.

          Precargar los chunks en sí no se puede: sus URLs llevan pegado el id
          del despliegue de Whop (`?dpl=…`), que cambia cada vez que publican.
          Un `preload` con la lista de hoy bajaría mañana archivos que ya nadie
          usa. */}
      <link rel="preconnect" href="https://whop.com" />
      <link rel="preconnect" href="https://content.whop.com" />
      <link rel="preconnect" href="https://img-v2-prod.whop.com" />
      <link rel="dns-prefetch" href="https://whop.com" />
      {children}
    </div>
  );
}
