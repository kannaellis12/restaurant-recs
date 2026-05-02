import Image from "next/image";
import Link from "next/link";
import { CITIES } from "@/lib/cities";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-8 py-6 border-b border-rule flex items-center justify-between">
        <Image
          src="/brand/RoR-logo-no-tagline.svg"
          alt="Restaurants of Reddit"
          width={300}
          height={68}
          priority
          className="h-10 w-auto"
        />
        <span className="font-mono text-mono-sm uppercase tracking-wider text-ink-3">
          v0.1 · Apr 2026
        </span>
      </header>

      <section className="flex-1 px-8 py-16 max-w-5xl mx-auto w-full">
        <div className="font-mono text-mono uppercase tracking-wider text-ink-3 mb-6 flex items-baseline gap-3">
          <span className="text-accent">●</span>
          <span>Field guide</span>
          <span className="text-rule-strong">·</span>
          <span>{CITIES.length} cities</span>
        </div>

        <h1
          className="font-display leading-[1.05] tracking-tight text-ink mb-6"
          style={{ fontSize: "clamp(36px, 5.5vw, 56px)" }}
        >
          A field guide to{" "}
          <em className="text-accent not-italic font-display italic">good food</em>,
          {" "}from the self-proclaimed experts of Reddit.
        </h1>

        <p className="font-body text-body text-ink-2 max-w-2xl mb-12">
          No online source is perfect, but we can at least try to skip the
          Karens of Google and Yelp. Starting with a small sample size: two
          food meccas and two food porta potties. You decide which is which.
        </p>

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-rule border border-rule">
          {CITIES.map((city, i) => (
            <li key={city.slug} className="bg-paper">
              <Link
                href={`/${city.slug}`}
                className="block px-6 py-8 hover:bg-paper-2 transition-colors group"
              >
                <div className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 mb-3">
                  {String(i + 1).padStart(2, "0")} / {String(CITIES.length).padStart(2, "0")}
                </div>
                <div className="font-display text-h2 leading-none text-ink group-hover:text-accent transition-colors">
                  {city.name}<span className="text-accent">.</span>
                </div>
                <div className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 mt-3">
                  {city.country}
                </div>
              </Link>
            </li>
          ))}
        </ul>

      </section>

      {/* Sign-off footer mirrors the header bookend: tagline on the left
          where the wordmark sits up top, wordmark centered, glyph on
          the right where the version stamp sits up top. Spans full
          page width so the bookends line up with the header. Items
          bottom-align to the glyph's baseline. */}
      <footer className="px-8 pt-16 pb-6 grid grid-cols-1 md:grid-cols-3 gap-6 md:items-end">
        <p className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3 text-center md:text-left max-w-sm">
          Mined from Reddit, served with a side of skepticism.
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
            className="h-20 w-auto"
          />
        </div>
      </footer>
    </main>
  );
}
