import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.trycloudflare.com", "192.168.*.*", "10.*.*.*"],
  async rewrites() {
    return [
      {
        source: "/limpiezas-energeticas",
        destination: "/paginas/vsl-limpiezas.html",
      },
      {
        source: "/vsl-maldiciones-familiares",
        destination: "/paginas/vsl-maldiciones.html",
      },
      {
        source: "/maldiciones-familiares",
        destination: "/paginas/up1.html",
      },
      {
        source: "/maldiciones-familiares-descuento",
        destination: "/paginas/dw1.html",
      },
      {
        source: "/introduccion-constelaciones-familiares",
        destination: "/paginas/up2.html",
      },
      {
        source: "/introduccion-constelaciones-descuento",
        destination: "/paginas/dw2.html",
      },
      {
        source: "/gracias",
        destination: "/paginas/gracias.html",
      },
    ];
  },
};

export default nextConfig;
