import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Belanja | Sentralogis",
  description: "Aplikasi operasional Belanja Sentralogis.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
