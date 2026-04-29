import { notFound } from "next/navigation";
import { CITIES_BY_SLUG } from "@/lib/cities";
import { supabase, type RestaurantWithScoresRow } from "@/lib/supabase";
import type { RestaurantSummary } from "@/lib/types";
import { CityView } from "./CityView";

type PageProps = {
  params: Promise<{ city: string }>;
};

export const revalidate = 60; // Cache the page for 60s; pipeline runs are infrequent.

export async function generateStaticParams() {
  return Object.keys(CITIES_BY_SLUG).map((slug) => ({ city: slug }));
}

export default async function CityPage({ params }: PageProps) {
  const { city: slug } = await params;
  const city = CITIES_BY_SLUG[slug];
  if (!city) notFound();

  // Only show restaurants that have at least one extraction backing them.
  // Restaurants resolved in past runs but no longer mentioned (e.g. orphans
  // after a demo-data wipe) have null city_rank and would clutter the list.
  const { data, error } = await supabase
    .from("restaurants_with_scores")
    .select("*")
    .eq("city_slug", slug)
    .eq("closed", false)
    .not("city_rank", "is", null)
    .order("city_rank", { ascending: true });

  if (error) {
    throw new Error(`Failed to load ${slug} restaurants: ${error.message}`);
  }

  const restaurants = (data ?? []).map(toSummary);

  return <CityView city={city} restaurants={restaurants} />;
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
    // city_rank can be null briefly between extraction and scoring — show
    // unranked rows at the bottom with a fallback rank value.
    cityRank: row.city_rank ?? 999,
  };
}
