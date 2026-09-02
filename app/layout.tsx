import type { Metadata } from "next";
import "./globals.css";
import MetaPixel from "./components/MetaPixel";

export const metadata: Metadata = {
  title: "Limpiezas Energéticas",
  description:
    "Limpieza energética guiada por Cristina Lozano, con checkout seguro en Whop.",
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
