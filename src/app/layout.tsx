import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "John Doe | Full Stack Developer",
  description: "Portfolio of John Doe - Full Stack Developer specializing in React, Next.js, and modern web technologies.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
