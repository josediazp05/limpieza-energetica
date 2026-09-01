import type { Metadata } from "next";
import "./globals.css";
import MetaPixel from "./components/MetaPixel";

export const metadata: Metadata = {
  title: "Limpieza Energética — Maldiciones Familiares",
  description:
    "Libera las maldiciones familiares que se repiten en tu árbol: la limpieza energética guiada por Cristina Lozano.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="antialiased">
      <body suppressHydrationWarning>
        {children}
        <MetaPixel />
      </body>
    </html>
  );
}
