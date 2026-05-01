"use client";

import { useMemo, useState } from "react";
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
};

export function RestaurantDetailView({ city, restaurant, quotes, siblings }: Props) {
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
      <header className="border-b border-rule px-6 py-3 flex items-center justify-between gap-4 sticky top-0 bg-paper/95 backdrop-blur z-10">
        <div className="flex items-center gap-5 min-w-0">
          <Link href="/" aria-label="Restaurants of Reddit — home" className="shrink-0">
            <Image
              src="/brand/RoR-logo-no-tagline.svg"
              alt="Restaurants of Reddit"
              width={180}
              height={40}
              priority
              className="h-6 w-auto"
            />
          </Link>
          <nav className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 flex items-baseline gap-2 min-w-0">
            <Link href="/" className="hover:text-ink transition-colors shrink-0">
              Cities
            </Link>
            <span className="text-rule-strong shrink-0">/</span>
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
          className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 hover:text-ink transition-colors shrink-0"
        >
          ← Back to {city.name}
        </Link>
      </header>

      <article className="max-w-5xl mx-auto px-8 py-12">
        {/* Title block: vertical rank stamp on the left, meta + display name
            + italic descriptor + action link on the right. */}
        <div className="grid grid-cols-1 md:grid-cols-[112px_1fr] gap-8 mb-10">
          <RankStamp rank={restaurant.cityRank} />

          <div>
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

            {/* The italic descriptor under the name was just regurgitating
                the cuisine + neighborhood already in the meta line above —
                editorial flair without earning it. Dropped. */}
            {restaurant.address && (
              <p className="font-mono text-mono uppercase tracking-[0.04em] text-ink-3 mt-3">
                {restaurant.address}
              </p>
            )}

            <ActionRow restaurant={restaurant} />
          </div>
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

        {/* Vibe filter — narrows both food and service sections to quotes
            carrying the selected tag. We hide the whole strip when the
            restaurant has no tagged quotes (the All button alone would be
            useless). */}
        {availableTags.length > 0 && (
          <div className="flex items-baseline gap-3 flex-wrap py-6 border-b border-rule">
            <span className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3 shrink-0">
              Filter quotes
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

        {/* Section 01 — food quotes */}
        <Section num="01" kicker="Food" heading="What people say.">
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

        {/* Section 02 — service quotes (smaller, secondary) */}
        <Section num="02" kicker="Service" heading="The other conversation.">
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

        {/* Section 03 — about: meta list + mini-map + tags */}
        <Section num="03" kicker="About" heading="The basics.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start">
            <MetaList city={city} restaurant={restaurant} />
            <div className="aspect-[1.4/1] border border-rule overflow-hidden">
              <RestaurantMiniMap restaurant={restaurant} />
            </div>
          </div>
          {restaurant.tags.length > 0 && (
            <div className="mt-8">
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
        </Section>

        {siblings.length > 0 && (
          <Section
            num="04"
            kicker="Locations"
            heading={`Also as ${restaurant.name}.`}
          >
            <SiblingsList city={city} siblings={siblings} />
          </Section>
        )}
      </article>
    </div>
  );
}

/* ---------- title block ------------------------------------------------- */

function RankStamp({ rank }: { rank: number }) {
  if (!rank || rank >= 999) return null;
  return (
    <div className="border-t border-ink pt-2 self-start">
      <div className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3">
        Rank
      </div>
      <div className="font-display font-medium text-h1 leading-none tracking-[-0.04em] text-accent mt-1">
        {String(rank).padStart(2, "0")}
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
 * The row of secondary actions under the descriptor: visit website, view
 * on Google Maps (which is also the "find a table" entry point — Google
 * shows the Reserve button on the place page when a reservation provider
 * is configured), and share.
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
        Find a table ↗
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
    "font-mono text-mono uppercase tracking-wider px-4 py-2 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors cursor-pointer";
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
        "py-10 px-2 md:px-8",
        borderLeft ? "md:border-l md:border-rule md:pl-12" : "",
      ].join(" ")}
    >
      <div className="font-mono text-mono uppercase tracking-[0.08em] text-ink">
        {label}
      </div>
      {score === null ? (
        <p
          className="font-display italic font-normal leading-tight tracking-tight text-absent mt-4 max-w-md"
          style={{ fontSize: "clamp(24px, 4vw, 36px)" }}
        >
          No one talked about it.
        </p>
      ) : (
        <>
          <div
            className={[
              "font-display font-medium leading-[0.95] tracking-[-0.04em] mt-3",
              accent ? "text-accent" : "text-ink",
            ].join(" ")}
            style={{ fontSize: "clamp(48px, 6vw, 64px)" }}
          >
            {(score * 10).toFixed(1)}
            <span className="font-mono text-ink-3 ml-2 tracking-[0.02em] text-mono">
              /10
            </span>
          </div>
          <div className="font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3 mt-3">
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
  kicker,
  heading,
  children,
}: {
  num: string;
  kicker: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-10 border-b border-rule last:border-b-0">
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5 items-baseline mb-6">
        <span className="font-mono text-mono-sm uppercase tracking-[0.08em] text-ink-3 border-t border-ink pt-3">
          {num} · {kicker}
        </span>
        <h2 className="font-display font-medium text-h3 leading-[1.05] tracking-[-0.015em] text-ink">
          {heading}
        </h2>
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
        {quotes.length} {quotes.length === 1 ? "quote" : "quotes"}
      </div>
      <div className="grid gap-8 max-w-3xl">
        {quotes.slice(0, 50).map((q) => (
          <Quote key={q.id} quote={q} aspect={aspect} />
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
    <div className="border-l border-ink pl-5 py-1 max-w-[64ch]">
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

      <blockquote className="font-body text-ink leading-[1.45] m-0" style={{ fontSize: "21px" }}>
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

      <div className="font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3 mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {quote.thread && (
          <>
            <span>r/{quote.thread.subreddit}</span>
            <span className="text-rule-strong">·</span>
            <a
              href={quote.thread.url}
              target="_blank"
              rel="noreferrer"
              className="text-ink-2 border-b border-rule-strong hover:text-ink hover:border-ink normal-case tracking-normal font-body text-body-sm italic"
            >
              {quote.thread.title}
            </a>
          </>
        )}
        {quote.commentAuthor && quote.thread && (
          <span className="text-rule-strong">·</span>
        )}
        {quote.commentAuthor &&
          (commentUrl ? (
            <a
              href={commentUrl}
              target="_blank"
              rel="noreferrer"
              className="text-ink-2 border-b border-rule-strong hover:text-ink hover:border-ink"
            >
              u/{quote.commentAuthor} ↗
            </a>
          ) : (
            <span>u/{quote.commentAuthor}</span>
          ))}
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
    rows.push({
      dt: "Hours",
      dd: (
        <ul className="grid gap-0.5">
          {restaurant.hoursLines.map((line, i) => (
            <li key={i} className="font-body text-body text-ink leading-snug">
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
          className="text-ink border-b border-rule-strong hover:border-ink"
        >
          {hostnameOf(restaurant.website)} ↗
        </a>
      ),
    });
  }

  if (rows.length === 0) return null;

  return (
    <dl className="grid">
      {rows.map((row, i) => (
        <div
          key={i}
          className={[
            "grid grid-cols-[120px_1fr] gap-4 items-baseline py-3",
            "border-t border-rule",
            i === rows.length - 1 ? "border-b" : "",
          ].join(" ")}
        >
          <dt className="font-mono text-mono-sm uppercase tracking-[0.06em] text-ink-3 m-0">
            {row.dt}
          </dt>
          <dd className="m-0 font-body text-body text-ink">{row.dd}</dd>
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
