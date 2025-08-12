import '../styles/globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Top tviti včeraj (Slovenija)',
  description: 'Povzetek najbolj odmevnih tvitov preteklega dne za Slovenijo, brez X API.'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sl">
      <body className="bg-black text-white">{children}</body>
    </html>
  );
}
