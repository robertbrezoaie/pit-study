import type { Metadata, Viewport } from 'next';
import { Nunito } from 'next/font/google';
import './globals.css';

// next/font downloads the font at build time and serves it from this site (no external requests).
const nunito = Nunito({ subsets: ['latin', 'latin-ext'], variable: '--font-nunito', display: 'swap' });

export const metadata: Metadata = {
  title: 'Punctul IT',
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro" className={nunito.variable}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
