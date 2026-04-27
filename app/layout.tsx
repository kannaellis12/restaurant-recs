import type { Metadata } from "next";
import { EB_Garamond, Source_Serif_4, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Display family — replaces the design's Kalice. EB Garamond is a free Garamond
// revival with the right editorial gravity at 100px+ headline sizes.
const displayFont = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-display-family",
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  display: "swap",
});

// Body / pull-quote family — replaces the design's Romie. Source Serif 4 is
// designed by Adobe for screen reading; its italic carries warmth that's
// critical for the pull-quote treatment.
const bodyFont = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-body-family",
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

// Mono family — for ranks, mention counts, dates, section numbers, and all
// UI chrome text. Always uppercase with letter-spacing in our base class.
const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-family",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Reddit Restaurants",
  description:
    "Restaurant rankings sourced from Reddit reviews. Food first, not service complaints.",
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
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
