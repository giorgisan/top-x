// app/layout.tsx
import './globals.css';
import { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sl">
      <body className="bg-black text-white">{children}</body>
    </html>
  );
}
