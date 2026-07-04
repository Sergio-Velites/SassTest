import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Providers } from '../components/providers';

import './globals.css';

export const metadata: Metadata = {
  title: 'FlowHub AI',
  description: 'Installable enterprise workflows with built-in AI',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
