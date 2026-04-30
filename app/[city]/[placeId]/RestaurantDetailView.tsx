"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { City } from "@/lib/cities";
import { CUISINES_BY_SLUG } from "@/lib/cuisines";
import {
  TAG_LABELS,
  TAGS,
  type RestaurantSummary,
  type Sentiment,
  type Tag,
} from "@/lib/types";
import { RestaurantMiniMap } from "./RestaurantMiniMap";

export type QuoteCard = {
  id: string;
  quote: string;
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
  const [vibeFilter, setVibeFilter] = useState<Tag | null>(null);

  // Tags that appear on at least one quote for this restaurant — drives the
  // filter buttons. We include the canonical taxonomy order, not whatever
  // order the LLM happened to emit.
  const availableQuoteTags = useMemo<Tag[]>(() => {
    const present = new Set<Tag>();
    for (const q of quotes) for (const t of q.tags) present.add(t);
    return TAGS.filter((t) => present.has(t));
  }, [quotes]);

  const filteredQuotes = useMemo(() => {
    if (!vibeFilter) return quotes;
    return quotes.filter((q) => q.tags.includes(vibeFilter));
  }, [quotes, vibeFilter]);

  return (
    <main className="max-w-5xl mx-auto px-6 py-6">
      <Breadcrumb city={city} restaurantName={restaurant.name} />

      <header className="mt-3 mb-6 flex flex-col md:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-3xl font-bold">{restaurant.name}</h1>
            {restaurant.cityRank > 0 && restaurant.cityRank < 999 && (
              <span className="text-sm text-gray-500 font-mono">
                #{restaurant.cityRank} in {city.name}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-500 mt-1">
            {[
              restaurant.neighborhood,
              restaurant.cuisines
                .map((c) => CUISINES_BY_SLUG[c]?.label ?? c)
                .join(", "),
              restaurant.priceLevel ? "$".repeat(restaurant.priceLevel) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {restaurant.address && (
            <div className="text-sm text-gray-500 mt-0.5">{restaurant.address}</div>
          )}
          {restaurant.website && (
            <a
              href={restaurant.website}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block"
            >
              {hostnameOf(restaurant.website)}
            </a>
          )}

          <div className="flex flex-wrap gap-4 mt-4 text-sm">
            <ScoreBadge label="Food" score={restaurant.foodScore} count={restaurant.foodUniqueUsers} />
            <ScoreBadge
              label="Service"
              score={restaurant.serviceScore}
              count={restaurant.serviceUniqueUsers}
            />
          </div>

          {(restaurant.cuisines.length > 0 || restaurant.tags.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {restaurant.cuisines.map((c) => (
                <Link
                  key={`cuisine-${c}`}
                  href={`/${city.slug}?cuisine=${encodeURIComponent(c)}`}
                  className="text-xs uppercase tracking-wide px-2 py-0.5 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  {CUISINES_BY_SLUG[c]?.label ?? c}
                </Link>
              ))}
              {restaurant.tags.map((t) => (
                <Link
                  key={`tag-${t}`}
                  href={`/${city.slug}?tag=${encodeURIComponent(t)}`}
                  className="text-xs uppercase tracking-wide px-2 py-0.5 rounded border border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                >
                  {TAG_LABELS[t]}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="w-full md:w-64 h-48 shrink-0 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800">
          <RestaurantMiniMap restaurant={restaurant} />
        </div>
      </header>

      {siblings.length > 0 && <OtherLocations city={city} siblings={siblings} />}

      <section className="mt-8">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-lg font-bold">
            What people are saying
            <span className="text-sm text-gray-500 font-normal ml-2">
              ({filteredQuotes.length}
              {vibeFilter && filteredQuotes.length !== quotes.length
                ? ` of ${quotes.length}`
                : ""}
              {filteredQuotes.length === 1 ? " quote" : " quotes"})
            </span>
          </h2>
        </div>

        {availableQuoteTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            <VibeButton
              active={vibeFilter === null}
              onClick={() => setVibeFilter(null)}
            >
              All
            </VibeButton>
            {availableQuoteTags.map((t) => (
              <VibeButton
                key={t}
                active={vibeFilter === t}
                onClick={() => setVibeFilter(vibeFilter === t ? null : t)}
              >
                {TAG_LABELS[t]}
              </VibeButton>
            ))}
          </div>
        )}

        {filteredQuotes.length === 0 ? (
          <div className="text-sm text-gray-500 py-8 text-center border border-dashed border-gray-300 dark:border-gray-700 rounded">
            {vibeFilter
              ? `No quotes tagged "${TAG_LABELS[vibeFilter]}". Try another vibe.`
              : "No quotes yet."}
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {filteredQuotes.slice(0, 50).map((q) => (
              <QuoteItem key={q.id} quote={q} />
            ))}
          </ul>
        )}

        {filteredQuotes.length > 50 && (
          <div className="text-xs text-gray-500 mt-3">
            Showing first 50 of {filteredQuotes.length}.
          </div>
        )}
      </section>
    </main>
  );
}

function Breadcrumb({ city, restaurantName }: { city: City; restaurantName: string }) {
  return (
    <nav className="text-sm text-gray-500">
      <Link href={`/${city.slug}`} className="hover:text-gray-700 dark:hover:text-gray-300">
        ← {city.name}
      </Link>
      <span className="mx-2">/</span>
      <span className="text-gray-700 dark:text-gray-300">{restaurantName}</span>
    </nav>
  );
}

function ScoreBadge({
  label,
  score,
  count,
}: {
  label: string;
  score: number | null;
  count: number;
}) {
  if (score === null) {
    return (
      <span className="text-gray-400 dark:text-gray-600">
        <span className="font-medium">{label}</span>
        <span className="italic ml-1">no data</span>
      </span>
    );
  }
  const value = score * 10;
  const color =
    value >= 7.5
      ? "text-green-700 dark:text-green-400"
      : value >= 5.0
        ? "text-amber-700 dark:text-amber-400"
        : "text-red-700 dark:text-red-400";
  return (
    <span>
      <span className="font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <span className={`font-semibold ml-1 ${color}`}>{value.toFixed(1)}</span>
      <span className="text-gray-500 ml-1">
        · {count} reviewer{count === 1 ? "" : "s"}
      </span>
    </span>
  );
}

function VibeButton({
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
        "text-xs uppercase tracking-wide px-2.5 py-1 rounded-full border transition-colors",
        active
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold"
          : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

const SENTIMENT_COLOR: Record<Sentiment, string> = {
  positive: "text-green-700 dark:text-green-400 border-green-300 dark:border-green-800",
  negative: "text-red-700 dark:text-red-400 border-red-300 dark:border-red-800",
  mixed: "text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800",
};

function QuoteItem({ quote }: { quote: QuoteCard }) {
  const commentUrl =
    quote.thread?.url && quote.commentRedditId
      ? `${quote.thread.url.replace(/\/$/, "")}/${quote.commentRedditId.replace(/^t1_/, "")}/`
      : quote.thread?.url ?? null;

  return (
    <li className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      {/* Source attribution: r/sub · "Thread title" · u/author */}
      {quote.thread && (
        <div className="text-xs text-gray-500 mb-2">
          <span className="text-gray-700 dark:text-gray-300">r/{quote.thread.subreddit}</span>
          {" · "}
          <a
            href={quote.thread.url}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            “{quote.thread.title}”
          </a>
          {quote.commentAuthor && (
            <>
              {" · "}
              {commentUrl ? (
                <a
                  href={commentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  u/{quote.commentAuthor}
                </a>
              ) : (
                <span>u/{quote.commentAuthor}</span>
              )}
            </>
          )}
        </div>
      )}

      {/* Optional in-reply-to context, truncated. */}
      {quote.parent && quote.parent.body && (
        <div className="text-xs text-gray-500 mb-2 border-l-2 border-gray-200 dark:border-gray-800 pl-2 italic">
          {quote.parent.author && (
            <span className="not-italic text-gray-400">
              In reply to u/{quote.parent.author}:{" "}
            </span>
          )}
          “{truncate(quote.parent.body, 120)}”
        </div>
      )}

      <blockquote className="text-base text-gray-800 dark:text-gray-200">
        “{quote.quote}”
      </blockquote>

      {(quote.food_sentiment || quote.service_sentiment || quote.tags.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {quote.food_sentiment && (
            <SentimentChip aspect="Food" sentiment={quote.food_sentiment} />
          )}
          {quote.service_sentiment && (
            <SentimentChip aspect="Service" sentiment={quote.service_sentiment} />
          )}
          {quote.tags.map((t) => (
            <span
              key={t}
              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"
            >
              {TAG_LABELS[t]}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function SentimentChip({
  aspect,
  sentiment,
}: {
  aspect: string;
  sentiment: Sentiment;
}) {
  return (
    <span
      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${SENTIMENT_COLOR[sentiment]}`}
    >
      {aspect} · {sentiment}
    </span>
  );
}

function OtherLocations({ city, siblings }: { city: City; siblings: SiblingLocation[] }) {
  return (
    <section className="mt-2 mb-4 border border-gray-200 dark:border-gray-800 rounded-lg p-4 bg-gray-50/40 dark:bg-gray-900/40">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">
        Other locations in {city.name}
      </div>
      <ul className="flex flex-col gap-1.5">
        {siblings.map((s) => (
          <li key={s.placeId} className="text-sm">
            <Link
              href={`/${city.slug}/${s.placeId}`}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              {s.name}
            </Link>
            {(s.neighborhood || s.address) && (
              <span className="text-gray-500 ml-2">
                {[s.neighborhood, s.address].filter(Boolean).join(" · ")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

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
