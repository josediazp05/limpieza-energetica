import { getCompany } from "@/lib/whop";
import { PRODUCT } from "./constants";

// Quién vende. Sale de Whop, no de un asset del repo: el comprador ve la misma
// marca en la cabecera y dentro del formulario de pago, y si cambia el logo en
// el dashboard no hay que tocar nada acá.

export interface Brand {
  name: string;
  /** El logo del negocio en Whop, o `null` si no tiene ninguno subido. */
  logoUrl: string | null;
}

export async function loadBrand(): Promise<Brand> {
  const companyId = process.env.WHOP_COMPANY_ID;
  // Lo escrito en `constants` manda sobre Whop: es la única forma de pisarlo.
  const override = PRODUCT.brand.trim();
  const overrideLogo = PRODUCT.brandLogo.trim();

  const company = companyId ? await getCompany(companyId) : null;

  return {
    name: override || company?.title || PRODUCT.brandFallback,
    logoUrl: overrideLogo || company?.logoUrl || null,
  };
}
