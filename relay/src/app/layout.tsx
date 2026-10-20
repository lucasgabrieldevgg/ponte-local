import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Relay — Ponte GalaxyCut',
  description: 'Relay do Modo Ponte do GalaxyCut-AI (fork adaptado do ponte-local de MicaelSanPedro, MIT)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
