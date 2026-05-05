import Image from "next/image";
import Link from "next/link";
import { CITIES } from "@/lib/cities";
import { CityRequest, RequestedCityBanner } from "./CityRequest";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <RequestedCityBanner />
      {/* Three-column header: logo (left) / "Request a city" (center) /
          version stamp (right). The 1fr/auto/1fr template gives the
          outer columns equal weight so the middle is visually centered
          regardless of how wide the wordmark renders. On mobile the
          request bar drops out — the wider widget below the city
          cards takes over there. */}
      <header className="px-4 sm:px-8 py-4 sm:py-6 border-b border-rule grid grid-cols-[auto_auto] sm:grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
        <Image
          src="/brand/RoR-logo-no-tagline.svg"
          alt="Restaurants of Reddit"
          width={300}
          height={68}
          priority
          className="h-8 sm:h-10 w-auto justify-self-start"
        />
        <div className="hidden sm:block w-64">
          <CityRequest compact />
        </div>
        <span className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 justify-self-end">
          v0.1 · May 2026
        </span>
      </header>

      <section className="flex-1 px-5 sm:px-8 py-10 sm:py-16 max-w-5xl mx-auto w-full">
        <div className="font-mono text-mono uppercase tracking-wider text-ink-3 mb-6 flex items-baseline gap-3">
          <span className="text-accent">●</span>
          <span>Field guide</span>
          <span className="text-rule-strong">·</span>
          <span>{CITIES.length} cities</span>
        </div>

        <h1 className="font-display font-medium leading-[0.95] tracking-[-0.02em] text-ink mb-6 text-[48px] sm:text-[56px] md:text-[72px]">
          Reviews from Reddit that{" "}
          <em className="text-accent font-display italic">filter out the Karens</em>.
        </h1>

        <p className="font-body text-body-sm sm:text-body text-ink-2 max-w-2xl mb-10 sm:mb-12">
          A source for finding good food online since Google and Yelp have
          become wastelands of nothing but service complaints and
          &ldquo;that Thai food was too spicy, boo hoo&rdquo; crap.
        </p>

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-rule border border-rule">
          {CITIES.map((city, i) => (
            <li key={city.slug} className="bg-paper">
              <Link
                href={`/${city.slug}`}
                className="block px-5 py-6 sm:px-6 sm:py-8 hover:bg-paper-2 transition-colors group"
              >
                <div className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 mb-3">
                  {String(i + 1).padStart(2, "0")} / {String(CITIES.length).padStart(2, "0")}
                </div>
                <div className="font-display text-[32px] sm:text-h2 leading-none text-ink group-hover:text-accent transition-colors">
                  {city.name}<span className="text-accent">.</span>
                </div>
                <div className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 mt-3">
                  {city.country}
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {/* "Request a city" widget — mobile only on the homepage; the
            desktop nav has a compact version. Locked to Mapbox
            suggestions so we collect a stable place_id per submission
            for the admin queue. */}
        <div className="sm:hidden mt-12 max-w-md">
          <CityRequest />
        </div>

      </section>

      {/* Sign-off footer mirrors the header bookend: tagline on the left
          where the wordmark sits up top, wordmark centered, glyph on
          the right where the version stamp sits up top. Spans full
          page width so the bookends line up with the header. Items
          bottom-align to the glyph's baseline. */}
      <footer className="px-5 sm:px-8 pt-10 sm:pt-16 pb-6 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 md:items-end">
        <p className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3 text-center md:text-left max-w-sm">
          A field guide to good food.{" "}
          <Link href="/about" className="hover:text-accent transition-colors underline-offset-4 hover:underline">
            About
          </Link>
        </p>
        <p className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3 text-center order-first md:order-none">
          Restaurants of Reddit
        </p>
        <div className="flex md:justify-end justify-center">
          <Image
            src="/brand/RoR-glyph.svg"
            alt="Restaurants of Reddit"
            width={80}
            height={80}
            className="h-12 sm:h-20 w-auto"
          />
        </div>
      </footer>
    </main>
  );
}
