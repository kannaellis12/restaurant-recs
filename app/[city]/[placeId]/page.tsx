import { notFound } from "next/navigation";
import { CITIES_BY_SLUG } from "@/lib/cities";
import { supabase, type RestaurantWithScoresRow } from "@/lib/supabase";
import type { RestaurantSummary, Tag } from "@/lib/types";
import { RestaurantDetailView, type QuoteCard, type SiblingLocation } from "./RestaurantDetailView";

type PageProps = {
  params: Promise<{ city: string; placeId: string }>;
};

export const revalidate = 60;

export default async function RestaurantDetailPage({ params }: PageProps) {
  const { city: citySlug, placeId } = await params;
  const city = CITIES_BY_SLUG[citySlug];
  if (!city) notFound();

  const { data: restaurantRow, error: rErr } = await supabase
    .from("restaurants_with_scores")
    .select("*")
    .eq("city_slug", citySlug)
    .eq("place_id", placeId)
    .maybeSingle();

  if (rErr) throw new Error(`Failed to load restaurant: ${rErr.message}`);
  if (!restaurantRow) notFound();

  const restaurant = toSummary(restaurantRow as RestaurantWithScoresRow);

  // All extractions for this restaurant. We fetch the comment + parent
  // pointer + thread context here; the parent comment body itself comes
  // from a follow-up query because we have only the parent's reddit_id
  // (not a foreign key the join can follow).
  const { data: extractions, error: eErr } = await supabase
    .from("extractions")
    .select(
      `
      id,
      food_sentiment,
      service_sentiment,
      quote_original,
      quote_translated,
      tags,
      comment:reddit_comments (
        reddit_id,
        body,
        author,
        parent_comment_id,
        posted_at,
        thread:reddit_threads ( reddit_id, subreddit, title, url, posted_at, author )
      )
      `,
    )
    .eq("restaurant_id", restaurant.id);

  if (eErr) throw new Error(`Failed to load extractions: ${eErr.message}`);

  type RawExtraction = {
    id: string;
    food_sentiment: "positive" | "negative" | "mixed" | null;
    service_sentiment: "positive" | "negative" | "mixed" | null;
    quote_original: string;
    quote_translated: string | null;
    tags: string[] | null;
    comment: {
      reddit_id: string;
      body: string;
      author: string | null;
      parent_comment_id: string | null;
      posted_at: string | null;
      thread: {
        reddit_id: string;
        subreddit: string;
        title: string;
        url: string;
        posted_at: string | null;
        author: string | null;
      } | null;
    } | null;
  };
  const rows = (extractions ?? []) as unknown as RawExtraction[];

  // Pull each unique parent comment's body in one batched query.
  const parentIds = Array.from(
    new Set(rows.map((e) => e.comment?.parent_comment_id).filter((x): x is string => Boolean(x))),
  );
  const parentMap = new Map<string, { body: string; author: string | null }>();
  if (parentIds.length > 0) {
    const { data: parents, error: pErr } = await supabase
      .from("reddit_comments")
      .select("reddit_id, body, author")
      .in("reddit_id", parentIds);
    if (pErr) throw new Error(`Failed to load parent comments: ${pErr.message}`);
    for (const p of parents ?? []) {
      parentMap.set(p.reddit_id as string, {
        body: (p.body as string) ?? "",
        author: (p.author as string | null) ?? null,
      });
    }
  }

  const quotes: QuoteCard[] = rows
    .filter((e) => e.comment) // can't render a card without source attribution
    .map((e) => {
      const parent = e.comment?.parent_comment_id
        ? parentMap.get(e.comment.parent_comment_id) ?? null
        : null;
      return {
        id: e.id,
        quote: e.quote_original,
        quote_translated: e.quote_translated,
        food_sentiment: e.food_sentiment,
        service_sentiment: e.service_sentiment,
        tags: ((e.tags ?? []) as Tag[]),
        commentRedditId: e.comment!.reddit_id,
        commentAuthor: e.comment?.author ?? null,
        commentPostedAt: e.comment?.posted_at ?? null,
        parent,
        thread: e.comment?.thread
          ? {
              subreddit: e.comment.thread.subreddit,
              title: e.comment.thread.title,
              url: e.comment.thread.url,
            }
          : null,
      };
    })
    // Newest comment first.
    .sort((a, b) => {
      const ta = a.commentPostedAt ? Date.parse(a.commentPostedAt) : 0;
      const tb = b.commentPostedAt ? Date.parse(b.commentPostedAt) : 0;
      return tb - ta;
    });

  // Sibling locations — same name + same city, different id, not closed.
  // We restrict to exact name match for v1; fuzzy matching ("Corvus" vs.
  // "Corvus Coffee Roasters") is a future enrichment.
  const { data: siblingRows } = await supabase
    .from("restaurants")
    .select("id, name, place_id, neighborhood, address")
    .eq("name", restaurant.name)
    .eq("city_slug", citySlug)
    .eq("closed", false)
    .neq("id", restaurant.id);

  const siblings: SiblingLocation[] = (siblingRows ?? []).map((s) => ({
    placeId: s.place_id as string,
    name: s.name as string,
    neighborhood: (s.neighborhood as string | null) ?? null,
    address: (s.address as string | null) ?? null,
  }));

  return (
    <RestaurantDetailView
      city={city}
      restaurant={restaurant}
      quotes={quotes}
      siblings={siblings}
    />
  );
}

function toSummary(row: RestaurantWithScoresRow): RestaurantSummary {
  return {
    id: row.id,
    placeId: row.place_id,
    name: row.name,
    citySlug: row.city_slug,
    neighborhood: row.neighborhood,
    address: row.address,
    website: row.website,
    priceLevel: (row.price_level ?? null) as 1 | 2 | 3 | 4 | null,
    location: [row.lng, row.lat],
    cuisines: row.cuisines ?? [],
    tags: ((row.tags ?? []) as RestaurantSummary["tags"]),
    foodScore: row.food_score,
    foodUniqueUsers: row.food_unique_users,
    serviceScore: row.service_score,
    serviceUniqueUsers: row.service_unique_users,
    totalUniqueUsers: row.total_unique_users,
    cityRank: row.city_rank ?? 999,
  };
}
