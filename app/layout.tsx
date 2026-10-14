import type { Metadata, Viewport } from 'next';
import { Mulish } from 'next/font/google';
import './globals.css';

// Brand font Muli (published on Google Fonts as "Mulish"). next/font downloads it at build time and
// serves it from this site, so learner pages make no external requests (spec 3).
const mulish = Mulish({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '700', '800'],
  variable: '--font-mulish',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Punctul IT',
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro" className={mulish.variable}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
