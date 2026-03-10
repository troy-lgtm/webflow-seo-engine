import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});

export const metadata = {
  title: "WARP SEO Console",
  description: "Operator-grade SEO lane control console"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <body style={{ fontFamily: "var(--font-sans), 'Space Grotesk', sans-serif" }}>{children}</body>
    </html>
  );
}
