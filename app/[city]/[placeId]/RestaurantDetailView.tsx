"use client";

import { Fragment, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { City } from "@/lib/cities";
import { CUISINES_BY_SLUG } from "@/lib/cuisines";
import {
  TAGS,
  TAG_LABELS,
  type RestaurantSummary,
  type Sentiment,
  type Tag,
} from "@/lib/types";
import { RestaurantMiniMap } from "./RestaurantMiniMap";

export type QuoteCard = {
  id: string;
  quote: string;
  /** English translation; null for English-source quotes. */
  quote_translated: string | null;
  food_sentiment: Sentiment | null;
  service_sentiment: Sentiment | null;
  tags: Tag[];
  commentRedditId: string;
  commentAuthor: string | null;
  commentPostedAt: string | null;
  parent: { body: string; author: string | null } | null;
  thread: { subreddit: string; title: string; url: string } | null;
};

export type SiblingLocation = {
  placeId: string;
  name: string;
  neighborhood: string | null;
  address: string | null;
};

type Props = {
  city: City;
  restaurant: RestaurantSummary;
  quotes: QuoteCard[];
  siblings: SiblingLocation[];
  /** Number of ranked restaurants in the city — drives the "X / Y" denominator
   *  on the rank stamp. Counted server-side and passed through so we don't
   *  have to fetch a count from the client. */
  totalRanked: number;
};

export function RestaurantDetailView({
  city,
  restaurant,
  quotes,
  siblings,
  totalRanked,
}: Props) {
  // Vibe filter: when set, both food and service quote sections narrow to
  // quotes carrying that tag. The filter strip lives near the top of the
  // page so it scopes both sections at once — the editorial intent is
  // "filter what people are saying," not just one aspect.
  const [vibeFilter, setVibeFilter] = useState<Tag | null>(null);

  // Tags that actually appear on at least one quote for this restaurant.
  // Order follows the canonical taxonomy, not whatever order the LLM
  // happened to emit; tags with zero quotes are hidden so the strip
  // doesn't suggest filters that would always come back empty.
  const availableTags = useMemo<Tag[]>(() => {
    const present = new Set<Tag>();
    for (const q of quotes) for (const t of q.tags) present.add(t);
    return TAGS.filter((t) => present.has(t));
  }, [quotes]);

  const filteredQuotes = useMemo(
    () => (vibeFilter ? quotes.filter((q) => q.tags.includes(vibeFilter)) : quotes),
    [quotes, vibeFilter],
  );

  // Editorial split: each section talks about ONE aspect. A single comment
  // that praised the food and panned the service shows up in both sections,
  // each time with the relevant sentiment chip.
  const foodQuotes = useMemo(
    () => filteredQuotes.filter((q) => q.food_sentiment !== null),
    [filteredQuotes],
  );
  const serviceQuotes = useMemo(
    () => filteredQuotes.filter((q) => q.service_sentiment !== null),
    [filteredQuotes],
  );

  const cuisineLabels = restaurant.cuisines
    .map((c) => CUISINES_BY_SLUG[c]?.label ?? c)
    .join(", ");

  return (
    <div className="bg-paper min-h-screen">
      {/* Page header — same chrome as the city page so navigation feels
          continuous. Logo on the left, breadcrumb in mono uppercase, a
          dedicated "back to {city}" link on the right. */}
      {/* On mobile we hide the dedicated "Back to {city}" link since the
          breadcrumb's city crumb already links to the same place; that
          frees the row of overlap pressure between logo and back link
          (same fix we made on the city page header). The breadcrumb
          itself drops the "Cities" parent crumb on mobile to keep the
          row compact — a tap on the wordmark already covers "go home". */}
      <header className="border-b border-rule px-4 sm:px-6 py-3 flex items-center justify-between gap-3 sm:gap-4 sticky top-0 bg-paper/95 backdrop-blur z-10">
        <div className="flex items-center gap-4 sm:gap-5 min-w-0">
          <Link href="/" aria-label="Restaurants of Reddit — home" className="shrink-0">
            <Image
              src="/brand/RoR-logo-no-tagline.svg"
              alt="Restaurants of Reddit"
              width={220}
              height={48}
              priority
              className="h-7 sm:h-8 w-auto"
            />
          </Link>
          <nav className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 flex items-baseline gap-2 min-w-0">
            <Link href="/" className="hidden sm:inline hover:text-ink transition-colors shrink-0">
              Cities
            </Link>
            <span className="hidden sm:inline text-rule-strong shrink-0">/</span>
            <Link
              href={`/${city.slug}`}
              className="hover:text-ink transition-colors shrink-0"
            >
              {city.name}
            </Link>
            <span className="text-rule-strong shrink-0">/</span>
            <span className="text-ink truncate">{restaurant.name}</span>
          </nav>
        </div>
        <Link
          href={`/${city.slug}`}
          className="hidden sm:inline font-mono text-mono-sm uppercase tracking-wider text-ink-3 hover:text-ink transition-colors shrink-0"
        >
          ← Back to {city.name}
        </Link>
      </header>

      {/* Article container is now fully boxed (border on all four sides)
          so each section's bottom rule terminates against a real edge
          instead of trailing into white space. The article itself has no
          padding — every direct child applies its own px-8 so internal
          divider rules span the full boxed width. The bottom rule of the
          last section is suppressed (`last:border-b-0`) so it doesn't
          stack on the article's outer bottom border. */}
      <article className="max-w-5xl mx-auto md:border-x md:border-t md:border-rule">
        {/* Title block: title content fills the page on the left, rank
            stamp anchored to the right with a thin vertical hairline
            between them — same separator pattern as the FOOD/SERVICE
            score columns below. */}
        <div className="px-5 sm:pl-9 sm:pr-8 pt-8 pb-8 sm:pt-12 sm:pb-10 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-8 items-start">
          <div className="min-w-0">
            <MetaRow
              items={[
                city.name,
                cuisineLabels || null,
                restaurant.priceLevel ? "$".repeat(restaurant.priceLevel) : null,
              ]}
            />

            <h1
              className="font-display font-medium leading-[0.95] tracking-[-0.02em] text-ink mt-3 break-words"
              style={{ fontSize: "clamp(40px, 6vw, 72px)" }}
            >
              {restaurant.name}
              <span className="text-accent">.</span>
            </h1>

            {restaurant.address && (
              <p className="font-mono text-mono uppercase tracking-[0.04em] text-ink-3 mt-3">
                {restaurant.address}
              </p>
            )}

            <ActionRow restaurant={restaurant} />
          </div>

          <RankStamp rank={restaurant.cityRank} total={totalRanked} />
        </div>

        {/* Scores band — two huge serif numerals. Food sits in the accent
            color, service in ink. "no data" renders italic ("No one talked
            about it") in the absent-variant per the design system. */}
        <div className="grid grid-cols-1 md:grid-cols-2 border-y border-rule">
          <ScoreColumn
            label="Food"
            score={restaurant.foodScore}
            mentions={foodQuotes.length}
            accent
          />
          <ScoreColumn
            label="Service"
            score={restaurant.serviceScore}
            mentions={serviceQuotes.length}
            borderLeft
          />
        </div>

        {/* Section 01 — about: practical info first. Address, hours,
            cuisines, price, website, plus the mini-map + vibe chips.
            The whole section is a 2-column grid so the vertical rule
            between the columns spans the FULL section height, touching
            both the previous section's bottom border (the scores band's
            bottom rule) and this section's own bottom border. The
            heading and vibe tags both live inside the LEFT column so
            their content lines up with the meta-list rows below. */}
        <section className="border-b border-rule grid grid-cols-1 md:grid-cols-2">
          <div className="md:border-r md:border-rule pt-8 pb-0 sm:py-10">
            <div className="px-5 sm:px-8 font-mono text-[11px] tracking-wider sm:text-mono-sm sm:tracking-[0.08em] uppercase text-accent mb-6">
              01 · The basics
            </div>
            <MetaList city={city} restaurant={restaurant} />
            {restaurant.tags.length > 0 && (
              <div className="px-5 sm:px-8 mt-8">
                <div className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3 mb-2">
                  Vibes
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {restaurant.tags.map((t) => (
                    <Link
                      key={t}
                      href={`/${city.slug}?tag=${encodeURIComponent(t)}`}
                      className="font-mono text-mono-sm uppercase tracking-[0.04em] px-2.5 py-1 rounded-full border border-accent bg-accent-soft text-accent-deep hover:bg-accent hover:text-paper transition-colors"
                    >
                      {TAG_LABELS[t]}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="w-full aspect-square md:aspect-auto md:h-full overflow-hidden">
            <RestaurantMiniMap restaurant={restaurant} />
          </div>
        </section>

        {/* Vibe filter — narrows both food and service sections to quotes
            carrying the selected tag. Lives right above the food section
            (the next thing it affects), not floating between unrelated
            sections. We hide the whole strip when the restaurant has no
            tagged quotes (the All button alone would be useless). */}
        {availableTags.length > 0 && (
          <div className="flex items-baseline gap-3 flex-wrap px-5 sm:px-8 py-4 sm:py-6 border-b border-rule">
            <span className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3 shrink-0">
              Filter mentions
            </span>
            <VibeChip
              active={vibeFilter === null}
              onClick={() => setVibeFilter(null)}
            >
              All
            </VibeChip>
            {availableTags.map((t) => (
              <VibeChip
                key={t}
                active={vibeFilter === t}
                onClick={() => setVibeFilter(vibeFilter === t ? null : t)}
              >
                {TAG_LABELS[t]}
              </VibeChip>
            ))}
          </div>
        )}

        {/* Section 02 — food quotes */}
        <Section num="02" heading="What people say about the food">
          {foodQuotes.length === 0 ? (
            <EmptySection
              text={
                vibeFilter
                  ? `No food quotes tagged "${TAG_LABELS[vibeFilter]}".`
                  : "No one talked about the food in detail."
              }
            />
          ) : (
            <QuoteStack quotes={foodQuotes} aspect="food" />
          )}
        </Section>

        {/* Section 03 — service quotes (smaller, secondary). Tonally
            consistent with the homepage's "Karens of Google and Yelp"
            voice — service complaints get a wink. */}
        <Section num="03" heading="What the Karens say about the service">
          {serviceQuotes.length === 0 ? (
            <EmptySection
              text={
                vibeFilter
                  ? `No service quotes tagged "${TAG_LABELS[vibeFilter]}".`
                  : "No one talked about it."
              }
            />
          ) : (
            <QuoteStack quotes={serviceQuotes} aspect="service" />
          )}
        </Section>

        {siblings.length > 0 && (
          <Section num="04" heading="Other locations">
            <SiblingsList city={city} siblings={siblings} />
          </Section>
        )}

      </article>

      {/* Full-width bottom rule — closes off the article's bottom edge but
          extends edge-to-edge across the screen so the page reads as a
          single horizontal break before the footer. */}
      <div className="border-t border-rule" />

      {/* Editorial sign-off bookending the page header. Lives OUTSIDE the
          max-width article so it spans the full page width — All-cities
          left-aligns with the wordmark in the top nav, the glyph
          right-aligns with the "Back to {city}" link, the wordmark sits
          centered. Items are bottom-aligned to the glyph's baseline so
          the row reads as a single bottom edge. */}
      <footer className="px-6 pt-12 pb-6 grid grid-cols-1 md:grid-cols-3 gap-6 md:items-end">
        <Link
          href="/"
          className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3 hover:text-ink transition-colors text-center md:text-left"
        >
          ← All cities
        </Link>
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
    </div>
  );
}

/* ---------- title block ------------------------------------------------- */

function RankStamp({ rank, total }: { rank: number; total: number }) {
  if (!rank || rank >= 999) return null;
  return (
    <div className="md:pl-6 self-start text-left min-w-[120px]">
      <div className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3">
        Rank
      </div>
      <div className="font-display font-medium leading-none tracking-[-0.04em] text-accent mt-2 flex items-baseline gap-1.5 justify-start">
        <span className="text-h1">{String(rank).padStart(2, "0")}</span>
        {total > 0 && (
          <span className="font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3">
            / {total}
          </span>
        )}
      </div>
    </div>
  );
}

function MetaRow({ items }: { items: (string | null)[] }) {
  const parts = items.filter((x): x is string => Boolean(x));
  return (
    <div className="font-mono text-mono uppercase tracking-[0.04em] text-ink-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {parts.map((p, i) => (
        <span key={i} className="contents">
          {i > 0 && <span className="text-rule-strong">·</span>}
          <span>{p}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The row of secondary actions: visit website, get directions (deep-links
 * to Google Maps; if Google has a reservation provider for the place,
 * the user will see a Reserve button there too — but we don't promise
 * that here, since most places don't), and share.
 */
function ActionRow({ restaurant }: { restaurant: RestaurantSummary }) {
  const [shareCopied, setShareCopied] = useState(false);

  const googleMapsUrl =
    "https://www.google.com/maps/search/?api=1" +
    `&query=${encodeURIComponent(restaurant.name)}` +
    `&query_place_id=${encodeURIComponent(restaurant.placeId)}`;

  const onShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const data: ShareData = {
      title: `${restaurant.name} — Restaurants of Reddit`,
      url,
    };
    try {
      // Native share sheet on mobile + capable desktop browsers; falls
      // back to clipboard when the API isn't available or the user
      // dismisses the sheet on a non-supporting platform.
      if (typeof navigator !== "undefined" && "share" in navigator && navigator.canShare?.(data)) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1800);
    } catch {
      // User dismissed the sheet or clipboard write failed; nothing to do.
    }
  };

  return (
    <div className="flex flex-wrap gap-2 mt-6">
      {restaurant.website && (
        <ActionButton href={restaurant.website} external>
          Visit website ↗
        </ActionButton>
      )}
      <ActionButton href={googleMapsUrl} external>
        Directions ↗
      </ActionButton>
      <ActionButton onClick={onShare}>
        {shareCopied ? "Link copied" : "Share"}
      </ActionButton>
    </div>
  );
}

/**
 * Editorial ghost-style action: mono uppercase, ink border, hover fills
 * with ink. Works as both a link (when `href` is set) and a button.
 */
function ActionButton({
  href,
  external = false,
  onClick,
  children,
}: {
  href?: string;
  external?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const className =
    "font-mono text-mono-sm uppercase tracking-wider px-3 py-1.5 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors cursor-pointer";
  if (href) {
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className={className}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}

/* ---------- scores band ------------------------------------------------ */

function ScoreColumn({
  label,
  score,
  mentions,
  accent = false,
  borderLeft = false,
}: {
  label: string;
  score: number | null;
  mentions: number;
  accent?: boolean;
  borderLeft?: boolean;
}) {
  return (
    <div
      className={[
        "py-6 px-5 md:pr-6",
        borderLeft
          ? "md:border-l md:border-rule md:pl-11"
          : "md:pl-9",
      ].join(" ")}
    >
      <div className="font-mono text-mono uppercase tracking-[0.08em] text-ink">
        {label}
      </div>
      {score === null ? (
        <p
          className="font-display italic font-normal leading-tight tracking-tight text-absent mt-2 max-w-md"
          style={{ fontSize: "clamp(20px, 3vw, 28px)" }}
        >
          No one talked about it.
        </p>
      ) : (
        <>
          <div
            className={[
              "font-display font-medium leading-[0.95] tracking-[-0.04em] mt-2",
              accent ? "text-accent" : "text-ink",
            ].join(" ")}
            style={{ fontSize: "clamp(36px, 4.5vw, 48px)" }}
          >
            {(score * 10).toFixed(1)}
            <span className="font-mono text-ink-3 ml-1.5 tracking-[0.02em] text-mono-sm">
              /10
            </span>
          </div>
          <div className="font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3 mt-2">
            <span className="text-ink font-medium">{mentions}</span> mention
            {mentions === 1 ? "" : "s"}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- section structure ----------------------------------------- */

function Section({
  num,
  heading,
  children,
}: {
  num: string;
  /** The full section heading. Renders as `{num} · {heading}` in the mono
   *  small font, accent-tinted. Replaces the old kicker + display-serif
   *  heading combo — the page reads cleaner with one line per section
   *  instead of two. */
  heading: string;
  children: React.ReactNode;
}) {
  return (
    // Padding lives on the section itself (not the outer article), so the
    // border-b rule at the bottom of each section spans the full boxed
    // article width and meets the article's left/right vertical rules
    // cleanly. last:border-b-0 keeps the bottommost section from stacking
    // a rule on top of the article's outer bottom border.
    <section className="px-5 sm:px-8 py-8 sm:py-10 border-b border-rule last:border-b-0">
      {/* Mobile uses a smaller font + tighter tracking so long headings
          like "What the Karens say about the service" still fit on one
          line at narrow widths. Desktop keeps the editorial mono-sm
          + 0.08em tracking. */}
      <div className="font-mono text-[11px] tracking-wider sm:text-mono-sm sm:tracking-[0.08em] uppercase text-accent mb-6 whitespace-nowrap overflow-hidden text-ellipsis">
        {num} · {heading}
      </div>
      {children}
    </section>
  );
}

/** Filter chip for the vibe-tag bar. Active = ink-filled; idle = outlined. */
function VibeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "font-mono text-mono-sm uppercase tracking-[0.04em] px-3 py-1 rounded-full border cursor-pointer transition-colors",
        active
          ? "border-ink bg-ink text-paper"
          : "border-rule-strong text-ink-2 hover:border-ink hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function EmptySection({ text }: { text: string }) {
  return (
    <p className="font-body italic text-h4 leading-snug text-absent max-w-md md:ml-[200px] md:pl-5">
      {text}
    </p>
  );
}

/* ---------- quote stack ----------------------------------------------- */

function QuoteStack({
  quotes,
  aspect,
}: {
  quotes: QuoteCard[];
  aspect: "food" | "service";
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5 md:gap-8 items-start">
      <div className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3">
        {quotes.length} {quotes.length === 1 ? "mention" : "mentions"}
      </div>
      <div className="grid gap-6 md:gap-8 max-w-3xl">
        {quotes.slice(0, 50).map((q, i, arr) => (
          <Fragment key={q.id}>
            <Quote quote={q} aspect={aspect} />
            {/* Mobile-only accent dot between mentions. The desktop
                layout already has the 200px "N mentions" gutter as a
                visual anchor; on mobile that gutter sits above the
                stack instead, so consecutive mentions need their own
                separator to keep the eye from running them together. */}
            {i < arr.length - 1 && (
              <div
                aria-hidden="true"
                className="md:hidden text-center text-accent text-2xl leading-none"
              >
                ·
              </div>
            )}
          </Fragment>
        ))}
        {quotes.length > 50 && (
          <p className="font-mono text-mono-sm uppercase tracking-wider text-ink-3">
            Showing first 50 of {quotes.length}.
          </p>
        )}
      </div>
    </div>
  );
}

function Quote({
  quote,
  aspect,
}: {
  quote: QuoteCard;
  aspect: "food" | "service";
}) {
  const sentiment =
    aspect === "food" ? quote.food_sentiment : quote.service_sentiment;
  const otherSentiment =
    aspect === "food" ? quote.service_sentiment : quote.food_sentiment;
  const otherLabel = aspect === "food" ? "Service" : "Food";

  const commentUrl =
    quote.thread?.url && quote.commentRedditId
      ? `${quote.thread.url.replace(/\/$/, "")}/${quote.commentRedditId.replace(/^t1_/, "")}/`
      : quote.thread?.url ?? null;

  const isTranslated =
    !!quote.quote_translated &&
    quote.quote_translated.trim() !== quote.quote.trim();

  return (
    // No more left rule — the sentiment + tag chips already mark a fresh
    // quote start, and the rule was just adding visual noise next to
    // every quote in the stack.
    <div className="py-1 max-w-[64ch]">
      {/* Aspect chip + tag chips above the quote so the eye knows what
          flavor of sentiment it's about to read. */}
      {(sentiment || otherSentiment || quote.tags.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {sentiment && (
            <SentimentChip
              aspect={aspect === "food" ? "Food" : "Service"}
              sentiment={sentiment}
              primary
            />
          )}
          {otherSentiment && (
            <SentimentChip aspect={otherLabel} sentiment={otherSentiment} />
          )}
          {quote.tags.map((t) => (
            <span
              key={t}
              className="font-mono text-mono-sm uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-rule-strong text-ink-2"
            >
              {TAG_LABELS[t]}
            </span>
          ))}
        </div>
      )}

      {/* In-reply-to context (parent comment) — small italic, terracotta " */}
      {quote.parent && quote.parent.body && (
        <div className="font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3 mb-2">
          {quote.parent.author && (
            <span>In reply to u/{quote.parent.author}: </span>
          )}
          <span className="font-body italic normal-case tracking-normal text-ink-2 text-body-sm">
            “{truncate(quote.parent.body, 120)}”
          </span>
        </div>
      )}

      <blockquote className="font-body text-ink leading-[1.45] m-0 text-[18px] sm:text-[21px]">
        <span className="text-accent" aria-hidden="true">&ldquo;</span>
        {isTranslated ? quote.quote_translated : quote.quote}
        <span className="text-accent" aria-hidden="true">&rdquo;</span>
      </blockquote>

      {isTranslated && (
        <div className="mt-3 pl-4 border-l border-rule-strong">
          <span className="font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3 mr-2">
            Original
          </span>
          <span className="font-body italic text-ink-2 text-body-sm">
            “{quote.quote}”
          </span>
        </div>
      )}

      <div className="font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3 mt-3">
        {quote.thread && (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>r/{quote.thread.subreddit}</span>
            <span className="text-rule-strong">·</span>
            <a
              href={quote.thread.url}
              target="_blank"
              rel="noreferrer"
              className="text-ink-2 hover:text-ink normal-case tracking-normal font-body text-body-sm italic"
            >
              {quote.thread.title}
            </a>
          </div>
        )}
        {quote.commentAuthor && (
          <div className="mt-1">
            {commentUrl ? (
              <a
                href={commentUrl}
                target="_blank"
                rel="noreferrer"
                className="text-ink-2 hover:text-ink"
              >
                u/{quote.commentAuthor} ↗
              </a>
            ) : (
              <span>u/{quote.commentAuthor}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const SENTIMENT_PRIMARY: Record<Sentiment, string> = {
  positive: "border-accent bg-accent-soft text-accent-deep",
  negative: "border-rule-strong bg-paper-2 text-ink",
  mixed: "border-flag bg-paper-2 text-flag",
};

const SENTIMENT_SECONDARY: Record<Sentiment, string> = {
  positive: "border-rule-strong text-ink-2",
  negative: "border-rule-strong text-ink-2",
  mixed: "border-rule-strong text-ink-2",
};

function SentimentChip({
  aspect,
  sentiment,
  primary = false,
}: {
  aspect: string;
  sentiment: Sentiment;
  primary?: boolean;
}) {
  const cls = primary ? SENTIMENT_PRIMARY[sentiment] : SENTIMENT_SECONDARY[sentiment];
  return (
    <span
      className={[
        "font-mono text-mono-sm uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border",
        cls,
      ].join(" ")}
    >
      {aspect} · {sentiment}
    </span>
  );
}

/* ---------- meta list ------------------------------------------------- */

function MetaList({
  city,
  restaurant,
}: {
  city: City;
  restaurant: RestaurantSummary;
}) {
  const cuisineLabels = restaurant.cuisines.map(
    (c) => CUISINES_BY_SLUG[c]?.label ?? c,
  );

  type Row = { dt: string; dd: React.ReactNode };
  const rows: Row[] = [];
  if (cuisineLabels.length > 0) {
    rows.push({
      dt: "Cuisine",
      dd: (
        <div className="flex flex-wrap gap-1.5">
          {cuisineLabels.map((label, i) => (
            <Link
              key={i}
              href={`/${city.slug}?cuisine=${encodeURIComponent(restaurant.cuisines[i])}`}
              className="font-mono text-mono-sm uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-rule-strong text-ink-2 hover:border-ink hover:text-ink"
            >
              {label}
            </Link>
          ))}
        </div>
      ),
    });
  }
  if (restaurant.neighborhood) {
    rows.push({ dt: "Neighborhood", dd: restaurant.neighborhood });
  }
  if (restaurant.address) {
    rows.push({ dt: "Address", dd: restaurant.address });
  }
  if (restaurant.priceLevel) {
    rows.push({ dt: "Price", dd: "$".repeat(restaurant.priceLevel) });
  }
  if (restaurant.hoursLines.length > 0) {
    const collapsed = collapseHours(restaurant.hoursLines);
    rows.push({
      dt: "Hours",
      dd: (
        <ul className="grid gap-0.5">
          {collapsed.map((line, i) => (
            <li key={i} className="font-body text-body-sm sm:text-body text-ink leading-snug">
              {line}
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (restaurant.website) {
    rows.push({
      dt: "Website",
      dd: (
        <a
          href={restaurant.website}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-ink border-b border-rule-strong hover:border-ink"
        >
          {hostnameOf(restaurant.website)} ↗
        </a>
      ),
    });
  }

  if (rows.length === 0) return null;

  return (
    // The dl spans the full left column of section 01 (article edge to
    // mid-section vertical rule). Each row's `border-t` therefore goes
    // edge-to-edge across that left half, meeting the article's left
    // border on one side and the mid-section vertical rule on the other.
    // Content is indented via the row's own `pl-8 pr-6` so text doesn't
    // sit flush against the article border. The first row gets no top
    // rule — the section's own header bottom-margin already creates
    // breathing space — but we keep the bottom rule on the last row so
    // the dl closes off cleanly above the next section.
    <dl className="grid">
      {rows.map((row, i) => (
        <div
          key={i}
          className={[
            "grid grid-cols-[100px_1fr] sm:grid-cols-[120px_1fr] gap-4 items-baseline py-3 pl-5 pr-4 sm:pl-8 sm:pr-6",
            i > 0 ? "border-t border-rule" : "",
            i === rows.length - 1 ? "border-b border-rule" : "",
          ].join(" ")}
        >
          <dt className="font-mono text-mono-sm uppercase tracking-[0.06em] text-ink-3 m-0">
            {row.dt}
          </dt>
          <dd className="m-0 font-body text-body-sm sm:text-body text-ink min-w-0 break-words">{row.dd}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- siblings -------------------------------------------------- */

function SiblingsList({
  city,
  siblings,
}: {
  city: City;
  siblings: SiblingLocation[];
}) {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5">
      <li className="md:col-span-2 grid md:grid-cols-[200px_1fr] gap-5 contents">
        <div className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3">
          {siblings.length} other location{siblings.length === 1 ? "" : "s"}
        </div>
        <div className="grid gap-4 max-w-2xl">
          {siblings.map((s) => (
            <Link
              key={s.placeId}
              href={`/${city.slug}/${s.placeId}`}
              className="block py-3 border-t border-rule last:border-b last:border-rule hover:bg-paper-2 transition-colors px-2 -mx-2"
            >
              <div className="font-display text-h4 font-medium tracking-tight text-ink hover:text-accent transition-colors">
                {s.name} →
              </div>
              {(s.neighborhood || s.address) && (
                <div className="font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3 mt-1">
                  {[s.neighborhood, s.address].filter(Boolean).join(" · ")}
                </div>
              )}
            </Link>
          ))}
        </div>
      </li>
    </ul>
  );
}

/* ---------- helpers --------------------------------------------------- */

function truncate(s: string, n: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= n) return trimmed;
  return trimmed.slice(0, n).trimEnd() + "…";
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Collapse consecutive days that share the same hours into ranges:
 *
 *   ["Monday: 5:30 – 9:30 PM", "Tuesday: 5:30 – 9:30 PM",
 *    "Wednesday: 5:30 – 9:30 PM", ..., "Saturday: 5:30 – 8:00 PM"]
 *
 * becomes
 *
 *   ["Mon – Fri: 5:30 – 9:30 PM", "Sat – Sun: 5:30 – 8:00 PM"]
 *
 * Robust to locale variation: we only collapse when the day prefix is
 * recognized AND the hour string is identical. Any line we can't parse
 * falls through verbatim so we never silently drop hours info.
 *
 * Google's `weekdayDescriptions` typically arrives Mon→Sun; we don't
 * reorder, just collapse consecutive runs.
 */
const DAY_ABBR: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

type ParsedDay = { day: string; hours: string };

function parseDayLine(line: string): ParsedDay | null {
  const idx = line.indexOf(":");
  if (idx < 0) return null;
  const day = line.slice(0, idx).trim();
  const hours = line.slice(idx + 1).trim();
  if (!DAY_ABBR[day]) return null;
  return { day: DAY_ABBR[day], hours };
}

export function collapseHours(lines: string[]): string[] {
  if (lines.length === 0) return [];
  const out: string[] = [];

  type Run = { start: string; end: string; hours: string };
  let run: Run | null = null;

  const flush = () => {
    if (!run) return;
    out.push(
      run.start === run.end
        ? `${run.start}: ${run.hours}`
        : `${run.start} – ${run.end}: ${run.hours}`,
    );
    run = null;
  };

  for (const line of lines) {
    const parsed = parseDayLine(line);
    if (!parsed) {
      // Unparseable line — flush the current run, emit verbatim, continue.
      flush();
      out.push(line);
      continue;
    }
    if (run && run.hours === parsed.hours) {
      run.end = parsed.day;
    } else {
      flush();
      run = { start: parsed.day, end: parsed.day, hours: parsed.hours };
    }
  }
  flush();
  return out;
}
