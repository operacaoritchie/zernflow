import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/provider";
import { getLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "ZernFlow - The Open Source ManyChat Alternative",
    template: "%s | ZernFlow",
  },
  description:
    "Automate DMs, comments, and flows across Instagram, Facebook, WhatsApp, Telegram, X, Bluesky, and Reddit. Free, self-hostable, and open source.",
  metadataBase: new URL("https://zernflow.com"),
  openGraph: {
    title: "ZernFlow - The Open Source ManyChat Alternative",
    description:
      "Automate DMs, comments, and flows across Instagram, Facebook, WhatsApp, Telegram, X, Bluesky, and Reddit. Free, self-hostable, and open source.",
    url: "https://zernflow.com",
    siteName: "ZernFlow",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ZernFlow - The Open Source ManyChat Alternative",
    description:
      "Automate DMs, comments, and flows across 7 platforms. Free, self-hostable, open source.",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("theme")==="dark"||(!localStorage.getItem("theme")&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
        {/* JSON-LD structured data for SoftwareApplication schema.
            Helps search engines understand that ZernFlow is a free web application,
            improving rich snippet eligibility for product-related queries. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "ZernFlow",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              description:
                "Open source ManyChat alternative. Automate DMs, comments, and flows across Instagram, Facebook, Telegram, X, Bluesky, and Reddit.",
            }),
          }}
        />
      </head>
      <body className={inter.className}>
        <I18nProvider
          locale={locale}
          messages={getMessages(locale)}
          fallback={getMessages(DEFAULT_LOCALE)}
        >
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
