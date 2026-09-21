import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/providers/SessionProvider";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { Analytics } from "@vercel/analytics/next"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Slayshot — Open-source AI video clipping",
  description:
    "Turn long-form video into sharp, captioned vertical clips. Slayshot is now open source.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SessionProvider>
      <html lang="en" suppressHydrationWarning>
        <body
          className={`${inter.variable} antialiased flex flex-col h-screen w-screen overflow-x-hidden`}
        >
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <main className="flex-grow h-full w-full">{children}</main>
            <Toaster richColors />
          </ThemeProvider>
        </body>
      </html>
      <Analytics />
    </SessionProvider>
  );
}
