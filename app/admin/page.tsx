import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase-admin";
import { LoginForm } from "./LoginForm";
import { FlagCard } from "./FlagCard";
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

  const flags = await loadOpenFlags();

  return (
    <main className="max-w-3xl mx-auto px-6 py-8">
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

      {flags.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          Nothing to review. The pipeline writes flags here when resolution confidence is low.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {flags.map((f) => (
            <FlagCard key={f.id} flag={f} />
          ))}
        </div>
      )}
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
              thread: { subreddit: string; title: string; url: string } | null;
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
          thread:reddit_threads ( subreddit, title, url )
        )
      ),
      restaurant:restaurants ( name, address, website, place_id )
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
