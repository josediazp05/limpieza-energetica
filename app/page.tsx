import { redirect } from "next/navigation";
import { VSL_URL } from "./(funnel)/funnel";

/**
 * La raíz de este sitio no tiene contenido propio: devuelve al comprador a la
 * VSL configurada en el embudo. Quien llegue suelto acá —un enlace viejo,
 * alguien que borró la ruta de la barra— va a verla en vez de a un 404.
 */
export default function Home() {
  redirect(VSL_URL);
}
