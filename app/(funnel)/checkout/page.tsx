import { shouldSaveCard } from "@/lib/geo";
import { abrirSesionDelPedido, httpsOrigin, urlDelEmbed } from "@/lib/sesion-checkout";
import CheckoutView from "./CheckoutView";
import { loadBrand } from "./brand";
import { PRODUCT } from "./constants";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: PageProps<"/checkout">) {
  const query = await searchParams;
  const fbclid = typeof query.fbclid === "string" ? query.fbclid : null;

  // La sesión se abre acá, en el servidor, y no en el navegador al hidratar.
  // Si el formulario esperara a que cargue todo el JS de la página, recién
  // entonces pediría la sesión y montaría el iframe. Así llega hecha en el
  // HTML, y con ella el `prefetch` que pone al navegador a bajar el iframe
  // desde el primer momento, en paralelo con el JS.
  const [brand, sesion, origin, saveCard] = await Promise.all([
    loadBrand(),
    abrirSesionDelPedido([], { fbclid }),
    httpsOrigin(),
    shouldSaveCard(),
  ]);

  const status = query.status;

  return (
    <>
      {sesion.session && (
        <link rel="prefetch" as="document" href={urlDelEmbed(sesion.session.id)} />
      )}
      <CheckoutView
        brand={brand}
        pricing={sesion.pricing}
        sesionInicial={sesion.session?.id ?? null}
        returnUrl={origin ? `${origin}${PRODUCT.returnPath}` : undefined}
        saveCard={saveCard}
        returnedStatus={typeof status === "string" ? status : undefined}
      />
    </>
  );
}
