import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Display family — Argesta Display by Atipo Foundry. Used for the city-name
// hero, restaurant names, score numerals, and the italicized "." flourish.
// Web-license-bundled in public/fonts/Argesta-Complete-Font-Web/.
const displayFont = localFont({
  src: [
    {
      path: "../public/fonts/Argesta-Complete-Font-Web/Argesta_Webfont/argestadisplay-regular-webfont.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/Argesta-Complete-Font-Web/Argesta_Webfont/argestadisplay-regularitalic-webfont.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-display-family",
  display: "swap",
});

// Body / pull-quote family — Novela by Atipo Foundry. Designed as a
// novelist's face; the italic carries the warmth that makes pull-quotes
// the hero element of the editorial design.
const bodyFont = localFont({
  src: [
    {
      path: "../public/fonts/Novela-Complete-Font-Web/Novela-webfontkit/novela-regular-webfont.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/Novela-Complete-Font-Web/Novela-webfontkit/novela-regularitalic-webfont.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-body-family",
  display: "swap",
});

// Mono family — Basier Square Mono Regular by Atipo Foundry. Single weight
// only (the full family is paid). All mono text is uppercase + letter-
// spaced per the design direction; we never need bold or italic mono, so
// regular alone is sufficient.
const monoFont = localFont({
  src: [
    {
      path: "../public/fonts/Basier_Mono_Square_Regular/Webfont/Basier-Square-Mono-Regular-Webfont/basiersquaremono-regular-webfont.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-mono-family",
  display: "swap",
});

// Site-wide tagline used in both the meta description and OG/Twitter
// previews. Matches the hero subhead so social previews read in the
// same voice as the homepage.
const SITE_DESCRIPTION =
  "Restaurant reviews from Reddit that filter out the Karens. A field " +
  "guide to good food in Denver, Paris, Calgary, and New Orleans.";

export const metadata: Metadata = {
  // Template lets per-route metadata prepend the page title — e.g. a
  // detail page can `export const metadata = { title: "Septime" }` and
  // it'll render as "Septime · Restaurants of Reddit".
  title: {
    default: "Restaurants of Reddit",
    template: "%s · Restaurants of Reddit",
  },
  description: SITE_DESCRIPTION,
  icons: {
    icon: "/brand/RoR-glyph1.svg",
  },
  openGraph: {
    title: "Restaurants of Reddit",
    description: SITE_DESCRIPTION,
    siteName: "Restaurants of Reddit",
    type: "website",
    locale: "en_US",
    // The actual image comes from the app/opengraph-image.png file
    // convention — Next.js attaches it automatically. We don't list
    // it here, otherwise the file-convention image is overridden.
  },
  twitter: {
    // 1200x630 art works as a "large image" card; the small-summary
    // card would crop it to a square thumbnail.
    card: "summary_large_image",
    title: "Restaurants of Reddit",
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
      style={{ colorScheme: "light" }}
    >
      <head>
        {/* Browser-level pin: forces native form widgets and scrollbars to
            stay light regardless of the user's OS dark-mode preference.
            Belt-and-suspenders with the `color-scheme: light` CSS in
            globals.css — this meta tag wins for some Chromium widgets even
            when CSS hasn't kicked in yet. */}
        <meta name="color-scheme" content="light" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
