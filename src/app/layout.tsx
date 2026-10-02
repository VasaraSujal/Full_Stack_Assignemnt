import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Legal Contract Analyzer',
  description: 'AI-powered legal contract analysis and citation engine',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
