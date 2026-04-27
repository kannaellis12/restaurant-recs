import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase-admin";
import { CITIES_BY_SLUG } from "@/lib/cities";
import { LoginForm } from "./LoginForm";
import { FlagCard } from "./FlagCard";
import { RestaurantEditor, type EditableRestaurant } from "./RestaurantEditor";
import { logout } from "./actions";

// Always render fresh — mutations need to show up immediately.
export const dynamic = "force-dynamic";

const AUTH_COOKIE = "admin-auth";

export default async function AdminPage() {
  const c = await cookies();
  const auth = c.get(AUTH_COOKIE)?.value;
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected || auth !== expected) {
    return <LoginForm />;
  }

  const [flags, restaurantsByCity] = await Promise.all([
    loadOpenFlags(),
    loadRestaurantsByCity(),
  ]);

  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <header className="flex items-baseline justify-between mb-6 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-sm text-gray-500 mt-1">
            {flags.length} open flag{flags.length === 1 ? "" : "s"}
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
        <h2 className="text-lg font-bold mb-3">Open flags</h2>
        {flags.length === 0 ? (
          <div className="text-sm text-gray-500 py-6">
            Nothing to review. The pipeline writes flags here when resolution
            confidence is low.
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
        </p>
        {Object.entries(restaurantsByCity).map(([citySlug, restaurants]) => {
          const city = CITIES_BY_SLUG[citySlug];
          return (
            <div key={citySlug} className="mb-8">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
                {city?.name ?? citySlug} · {restaurants.length}
              </h3>
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
          );
        })}
      </section>
    </main>
  );
}

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
    name: string;
    address: string | null;
    website: string | null;
    place_id: string;
  } | null;
};

async function loadRestaurantsByCity(): Promise<Record<string, EditableRestaurant[]>> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, name, address, neighborhood, cuisines, price_level, website, city_slug")
    .eq("closed", false)
    .order("name", { ascending: true });
  if (error) throw new Error(`Failed to load restaurants: ${error.message}`);
  const byCity: Record<string, EditableRestaurant[]> = {};
  for (const r of data ?? []) {
    const slug = r.city_slug as string;
    (byCity[slug] ??= []).push({
      id: r.id as string,
      name: r.name as string,
      address: (r.address as string | null) ?? null,
      neighborhood: (r.neighborhood as string | null) ?? null,
      cuisines: (r.cuisines as string[] | null) ?? [],
      price_level: (r.price_level as number | null) ?? null,
      website: (r.website as string | null) ?? null,
    });
  }
  return byCity;
}

async function loadOpenFlags(): Promise<FlagWithContext[]> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("flags")
    .select(
      `
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
      restaurant:restaurants ( id, name, address, website, place_id )
      `,
    )
    .eq("status", "open")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load flags: ${error.message}`);
  }
  // supabase-js can't reliably infer one-vs-many on nested embeds without
  // generated types, so we assert the shape here. PostgREST returns single
  // objects (not arrays) for many-to-one relationships like ours.
  return (data ?? []) as unknown as FlagWithContext[];
}
