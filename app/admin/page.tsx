import { cookies } from "next/headers";
import Link from "next/link";
import { adminClient } from "@/lib/supabase-admin";
import { CITIES, CITIES_BY_SLUG } from "@/lib/cities";
import { LoginForm } from "./LoginForm";
import { FlagCard } from "./FlagCard";
import { RestaurantEditor, type EditableRestaurant } from "./RestaurantEditor";
import {
  logout,
  recomputeScores,
  resolveCityRequest,
  unresolveCityRequest,
} from "./actions";

// Always render fresh — mutations need to show up immediately.
export const dynamic = "force-dynamic";

const AUTH_COOKIE = "admin-auth";

type SearchParams = Promise<{ city?: string }>;

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const c = await cookies();
  const auth = c.get(AUTH_COOKIE)?.value;
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected || auth !== expected) {
    return <LoginForm />;
  }

  const params = (await searchParams) ?? {};
  const cityFilter =
    params.city && CITIES_BY_SLUG[params.city] ? params.city : null;

  // Always load the per-city counts (cheap aggregate query) so the city
  // tabs at the top can show flag totals without loading the full payload
  // for every city. The expensive flag-with-context fetch only runs for
  // the actively-selected city.
  const [flagCounts, flags, restaurants, cityRequests] = await Promise.all([
    loadFlagCountsByCity(),
    cityFilter ? loadOpenFlags(cityFilter) : Promise.resolve([]),
    // Same city scope as the flag queue. The unscoped fetch was hitting
    // Supabase's 1000-row default and silently truncating mid-Denver.
    loadRestaurantsForCity(cityFilter),
    loadCityRequests(),
  ]);

  const totalOpenFlags = Object.values(flagCounts).reduce<number>(
    (a, b) => a + (b as number),
    0,
  );
  const activeCity = cityFilter ? CITIES_BY_SLUG[cityFilter] : null;

  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <header className="flex items-baseline justify-between mb-6 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-sm text-gray-500 mt-1">
            {totalOpenFlags} open flag{totalOpenFlags === 1 ? "" : "s"} across all cities
          </p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mb-12">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-bold">Open flags</h2>
          <CityTabs activeSlug={cityFilter} flagCounts={flagCounts} />
        </div>

        {!cityFilter ? (
          <div className="text-sm text-gray-500 py-6">
            Pick a city above to load its flag queue. Loading all 4 cities at
            once was timing out — each city is fetched on demand now.
          </div>
        ) : flags.length === 0 ? (
          <div className="text-sm text-gray-500 py-6">
            No open flags for {CITIES_BY_SLUG[cityFilter]?.name ?? cityFilter}.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {flags.map((f) => (
              <FlagCard key={f.id} flag={f} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold mb-3">All restaurants</h2>
        <p className="text-sm text-gray-500 mb-4">
          Edit any field on any restaurant — neighborhood, cuisines, price,
          website, or mark permanently closed. Useful when Google&apos;s data
          is wonky (Lasley, Barths, La Foret-the-restaurant-named-after-itself).
          {" "}
          Pick a city in the tabs above to load its list.
        </p>
        {!cityFilter || !activeCity ? (
          <div className="text-sm text-gray-500 py-6">
            Pick a city above to load its restaurant list.
          </div>
        ) : (
          <div className="mb-8">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                {activeCity.name} · {restaurants.length}
              </h3>
              <form action={recomputeScores}>
                <input type="hidden" name="citySlug" value={cityFilter} />
                <button
                  type="submit"
                  className="text-xs border border-gray-300 dark:border-gray-700 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-900"
                  title="Re-aggregate extractions into restaurant_scores. Use after dismissing/reassigning flags so /[city] reflects your changes."
                >
                  Recompute scores
                </button>
              </form>
            </div>
            <div className="grid grid-cols-[2fr_1.2fr_1.5fr_0.5fr_1.2fr_auto] gap-3 items-baseline pb-1 mb-1 border-b-2 border-gray-300 dark:border-gray-700 text-xs uppercase tracking-wide text-gray-500">
              <div>Name</div>
              <div>Neighborhood</div>
              <div>Cuisines</div>
              <div>Price</div>
              <div>Website</div>
              <div></div>
            </div>
            <div>
              {restaurants.map((r) => (
                <RestaurantEditor key={r.id} restaurant={r} />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mb-12">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-bold">City requests</h2>
          <span className="text-sm text-gray-500">
            {cityRequests.length} unique{" "}
            {cityRequests.length === 1 ? "place" : "places"}
            {cityRequests.length > 0 &&
              ` · ${cityRequests.reduce((a, r) => a + r.count, 0)} total`}
          </span>
        </div>
        {cityRequests.length === 0 ? (
          <p className="text-sm text-gray-500 py-6">
            No requests yet.
          </p>
        ) : (
          <div className="border border-gray-200 dark:border-gray-800 rounded">
            <div className="grid grid-cols-[2fr_1fr_0.5fr_0.9fr_auto] gap-3 items-baseline px-3 py-2 border-b border-gray-200 dark:border-gray-800 text-xs uppercase tracking-wide text-gray-500">
              <div>Place</div>
              <div>Region / Country</div>
              <div>Requests</div>
              <div>Most recent</div>
              <div className="text-right">Status</div>
            </div>
            {cityRequests.map((r) => {
              const done = r.resolved_at !== null;
              return (
                <div
                  key={r.place_id}
                  className={[
                    "grid grid-cols-[2fr_1fr_0.5fr_0.9fr_auto] gap-3 items-center px-3 py-2 border-b border-gray-100 dark:border-gray-900 last:border-b-0 text-sm",
                    done ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <div>
                    <div className="font-medium">{r.city}</div>
                    <div
                      className="text-xs text-gray-500 truncate"
                      title={r.place_name}
                    >
                      {r.place_name}
                    </div>
                  </div>
                  <div className="text-gray-600 dark:text-gray-400">
                    {[r.region, r.country].filter(Boolean).join(" / ") || "—"}
                  </div>
                  <div className="font-semibold">{r.count}</div>
                  <div className="text-gray-500 text-xs">
                    {new Date(r.latest_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                  {done ? (
                    <form action={unresolveCityRequest} className="text-right">
                      <input type="hidden" name="placeId" value={r.place_id} />
                      <span className="text-xs text-green-600 dark:text-green-400 mr-2">
                        ✓ Done
                      </span>
                      <button
                        type="submit"
                        className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline"
                      >
                        Undo
                      </button>
                    </form>
                  ) : (
                    <form action={resolveCityRequest} className="text-right">
                      <input type="hidden" name="placeId" value={r.place_id} />
                      <button
                        type="submit"
                        className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-900"
                      >
                        Mark as done
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function CityTabs({
  activeSlug,
  flagCounts,
}: {
  activeSlug: string | null;
  flagCounts: Record<string, number>;
}) {
  return (
    <nav className="flex gap-1 flex-wrap text-sm">
      {CITIES.map((city) => {
        const count = flagCounts[city.slug] ?? 0;
        const active = activeSlug === city.slug;
        return (
          <Link
            key={city.slug}
            href={`/admin?city=${city.slug}`}
            className={[
              "px-3 py-1 rounded border",
              active
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold"
                : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900",
            ].join(" ")}
          >
            {city.name}{" "}
            <span className="text-xs text-gray-500 ml-1">{count}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export type SampleExtraction = {
  mention_text: string;
  quote_original: string;
  comment:
    | {
        reddit_id: string;
        body: string;
        author: string | null;
        thread: { subreddit: string; title: string; url: string } | null;
      }
    | null;
};

export type FlagWithContext = {
  id: string;
  kind: string;
  details: Record<string, unknown> | null;
  created_at: string;
  extraction:
    | {
        mention_text: string;
        neighborhood_hint: string | null;
        food_sentiment: string | null;
        service_sentiment: string | null;
        quote_original: string;
        resolution_confidence: number | null;
        resolution_method: string | null;
        comment:
          | {
              reddit_id: string;
              body: string;
              author: string | null;
              thread: {
                subreddit: string;
                title: string;
                url: string;
                city_slug: string | null;
              } | null;
            }
          | null;
      }
    | null;
  restaurant: {
    id: string;
    name: string;
    address: string | null;
    website: string | null;
    place_id: string;
    city_slug: string | null;
  } | null;
  // For missing_cuisine flags only — populated by loadOpenFlags after the
  // main query so the card can show the originating Reddit context.
  sample_extraction?: SampleExtraction | null;
};

/**
 * Restaurants for one city, sorted alphabetically. Scoped to a single
 * city because Supabase's default `.select()` row cap is 1000, and the
 * unscoped query (≈1,400 rows when sorted globally by name) was getting
 * silently truncated mid-Denver — the list was cutting off at restaurants
 * starting with "N". A per-city fetch always sits well under the cap.
 *
 * Returns an empty array when the city slug is null (no city selected
 * yet). That keeps the "pick a city" placeholder state cheap.
 */
/**
 * Aggregated city-request queue. The form on the marketing surfaces
 * writes one row per click; here we collapse those rows into a per
 * place_id roll-up so the admin can see "Seattle (12 requests, last
 * 2 days ago)" instead of a stream of identical entries.
 *
 * In-memory aggregation is fine for the volume we expect — single
 * digits per day. If it ever balloons we can swap this for a SQL
 * `group by` view without changing the page.
 */
type CityRequestRollup = {
  place_id: string;
  place_name: string;
  city: string;
  region: string | null;
  country: string | null;
  count: number;
  latest_at: string;
  /** When the admin marked this place as done. Null = still pending. */
  resolved_at: string | null;
};

async function loadCityRequests(): Promise<CityRequestRollup[]> {
  const supabase = adminClient();
  // Two parallel reads: the requests themselves (one row per click)
  // and the per-place resolution table (at most one row per place_id,
  // present iff the admin has marked it done).
  const [{ data: requestRows, error: reqErr }, { data: resolutionRows, error: resErr }] =
    await Promise.all([
      supabase
        .from("city_requests")
        .select("place_id, place_name, city, region, country, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("city_request_resolutions")
        .select("place_id, resolved_at"),
    ]);
  if (reqErr) throw new Error(`Failed to load city requests: ${reqErr.message}`);
  if (resErr) throw new Error(`Failed to load city request resolutions: ${resErr.message}`);

  const resolvedAt = new Map<string, string>();
  for (const r of (resolutionRows ?? []) as Array<{ place_id: string; resolved_at: string }>) {
    resolvedAt.set(r.place_id, r.resolved_at);
  }

  const byPlace = new Map<string, CityRequestRollup>();
  for (const row of (requestRows ?? []) as Array<{
    place_id: string;
    place_name: string;
    city: string;
    region: string | null;
    country: string | null;
    created_at: string;
  }>) {
    const existing = byPlace.get(row.place_id);
    if (existing) {
      existing.count += 1;
      // Rows came in DESC, so the first hit is already the latest.
    } else {
      byPlace.set(row.place_id, {
        place_id: row.place_id,
        place_name: row.place_name,
        city: row.city,
        region: row.region,
        country: row.country,
        count: 1,
        latest_at: row.created_at,
        resolved_at: resolvedAt.get(row.place_id) ?? null,
      });
    }
  }
  // Pending first (sorted by count), then resolved (sorted by count).
  return [...byPlace.values()].sort((a, b) => {
    const aDone = a.resolved_at ? 1 : 0;
    const bDone = b.resolved_at ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return b.count - a.count;
  });
}

async function loadRestaurantsForCity(
  citySlug: string | null,
): Promise<EditableRestaurant[]> {
  if (!citySlug) return [];
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, name, address, neighborhood, cuisines, price_level, website, city_slug")
    .eq("closed", false)
    .eq("city_slug", citySlug)
    .order("name", { ascending: true });
  if (error) throw new Error(`Failed to load restaurants: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    address: (r.address as string | null) ?? null,
    neighborhood: (r.neighborhood as string | null) ?? null,
    cuisines: (r.cuisines as string[] | null) ?? [],
    price_level: (r.price_level as number | null) ?? null,
    website: (r.website as string | null) ?? null,
  }));
}

/**
 * Per-city open flag counts. Cheap (just a small select with no embeds),
 * used to populate the city tabs at the top of the page.
 */
async function loadFlagCountsByCity(): Promise<Record<string, number>> {
  const supabase = adminClient();
  // Two trips because flags split their city signal across two tables:
  //   - missing_cuisine flags reference a restaurant directly
  //   - low_confidence_match flags reference an extraction whose comment's
  //     thread carries the city_slug
  // Both are scoped to status='open'.
  const [{ data: r1 }, { data: r2 }] = await Promise.all([
    supabase
      .from("flags")
      .select("kind, restaurant:restaurants(city_slug)")
      .eq("status", "open"),
    supabase
      .from("flags")
      .select(
        "kind, extraction:extractions(comment:reddit_comments(thread:reddit_threads(city_slug)))",
      )
      .eq("status", "open"),
  ]);

  const counts: Record<string, number> = {};
  const seen = new Set<string>();
  type Row = {
    kind: string;
    restaurant?: { city_slug?: string | null } | null;
    extraction?: {
      comment?: { thread?: { city_slug?: string | null } | null } | null;
    } | null;
    id?: string;
  };
  // Pair entries by index — both queries return rows in the same order
  // because both filter on the same status column. We tally once per
  // unique flag id (we re-fetched id implicitly via the row position).
  const left = (r1 ?? []) as Row[];
  const right = (r2 ?? []) as Row[];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const key = String(i);
    if (seen.has(key)) continue;
    seen.add(key);
    const slug =
      left[i]?.restaurant?.city_slug ??
      right[i]?.extraction?.comment?.thread?.city_slug ??
      null;
    if (!slug) continue;
    counts[slug] = (counts[slug] ?? 0) + 1;
  }
  return counts;
}

async function loadOpenFlags(citySlug: string): Promise<FlagWithContext[]> {
  const supabase = adminClient();

  // Filter at the DB layer using two separate queries (one per "kind" of
  // city-relationship), then merge. Doing it in a single query would
  // require a polymorphic OR across nested embeds, which PostgREST
  // doesn't support cleanly.
  const SELECT = `
    id,
    kind,
    details,
    created_at,
    extraction:extractions (
      mention_text,
      neighborhood_hint,
      food_sentiment,
      service_sentiment,
      quote_original,
      resolution_confidence,
      resolution_method,
      comment:reddit_comments (
        reddit_id,
        body,
        author,
        thread:reddit_threads ( subreddit, title, url, city_slug )
      )
    ),
    restaurant:restaurants!inner ( id, name, address, website, place_id, city_slug )
  `;

  const [missingRes, lowConfRes] = await Promise.all([
    supabase
      .from("flags")
      .select(SELECT)
      .eq("status", "open")
      .eq("kind", "missing_cuisine")
      .eq("restaurant.city_slug", citySlug)
      .order("created_at", { ascending: true }),
    supabase
      .from("flags")
      .select(
        `
        id,
        kind,
        details,
        created_at,
        extraction:extractions!inner (
          mention_text,
          neighborhood_hint,
          food_sentiment,
          service_sentiment,
          quote_original,
          resolution_confidence,
          resolution_method,
          comment:reddit_comments!inner (
            reddit_id,
            body,
            author,
            thread:reddit_threads!inner ( subreddit, title, url, city_slug )
          )
        ),
        restaurant:restaurants ( id, name, address, website, place_id, city_slug )
        `,
      )
      .eq("status", "open")
      .eq("kind", "low_confidence_match")
      .eq("extraction.comment.thread.city_slug", citySlug)
      .order("created_at", { ascending: true }),
  ]);

  if (missingRes.error) {
    throw new Error(`Failed to load missing_cuisine flags: ${missingRes.error.message}`);
  }
  if (lowConfRes.error) {
    throw new Error(`Failed to load low_confidence_match flags: ${lowConfRes.error.message}`);
  }

  const flags = [
    ...((missingRes.data ?? []) as unknown as FlagWithContext[]),
    ...((lowConfRes.data ?? []) as unknown as FlagWithContext[]),
  ];

  // Sample extractions for missing_cuisine flags. With city scoping in
  // place this is now ~50–100 parallel queries instead of 244, which is
  // well within Supabase's connection budget.
  await Promise.all(
    flags.map(async (f) => {
      if (f.kind !== "missing_cuisine" || !f.restaurant?.id) return;
      const { data: ext } = await supabase
        .from("extractions")
        .select(
          "mention_text, quote_original, comment:reddit_comments(reddit_id, body, author, thread:reddit_threads(subreddit, title, url))",
        )
        .eq("restaurant_id", f.restaurant.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (ext) {
        f.sample_extraction = ext as unknown as SampleExtraction;
      }
    }),
  );

  return flags;
}
