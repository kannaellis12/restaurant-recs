-- Reddit Restaurants — initial schema.
-- Run after creating the Supabase project. PostGIS provides geo types for the map.

create extension if not exists postgis;

-- Cities are seeded from the app code (see lib/cities.ts) but mirrored here so
-- foreign keys are enforceable at the DB level.
create table if not exists cities (
  slug         text primary key,
  name         text not null,
  country      text not null,
  language     text not null check (language in ('en', 'fr')),
  center_lng   double precision not null,
  center_lat   double precision not null,
  created_at   timestamptz not null default now()
);

-- One row per restaurant we've matched. `place_id` is the Google Places ID
-- and is the canonical identity. Duplicates can occur during reconciliation
-- and are merged via the admin UI.
create table if not exists restaurants (
  id               uuid primary key default gen_random_uuid(),
  place_id         text not null unique,
  name             text not null,
  city_slug        text not null references cities(slug),
  neighborhood     text,
  address          text,
  website          text,
  phone            text,
  price_level      smallint check (price_level between 1 and 4),
  google_rating    numeric(2, 1),
  google_review_ct integer,
  geog             geography(point, 4326) not null,
  cuisines         text[] not null default '{}',
  closed           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists restaurants_city_idx on restaurants (city_slug);
create index if not exists restaurants_geog_idx on restaurants using gist (geog);
create index if not exists restaurants_cuisines_idx on restaurants using gin (cuisines);

-- Reddit threads we've pulled. One row per thread URL.
create table if not exists reddit_threads (
  id            uuid primary key default gen_random_uuid(),
  reddit_id     text not null unique,        -- Reddit's t3_ id without the prefix
  url           text not null,
  subreddit     text not null,
  title         text not null,
  author        text,
  posted_at     timestamptz not null,
  city_slug     text references cities(slug),-- which city we pulled it for (null = global sub)
  relevance     numeric(3, 2),               -- LLM-judged relevance 0..1
  comment_count integer not null default 0,
  fetched_at    timestamptz not null default now()
);

create index if not exists reddit_threads_city_idx on reddit_threads (city_slug);
create index if not exists reddit_threads_subreddit_idx on reddit_threads (subreddit);

-- One row per Reddit comment we've considered. We store the full body so we
-- can re-extract if our prompts/models change.
create table if not exists reddit_comments (
  id           uuid primary key default gen_random_uuid(),
  reddit_id    text not null unique,
  thread_id    uuid not null references reddit_threads(id) on delete cascade,
  author       text,
  body         text not null,
  posted_at    timestamptz not null,
  fetched_at   timestamptz not null default now()
);

create index if not exists reddit_comments_thread_idx on reddit_comments (thread_id);
create index if not exists reddit_comments_author_idx on reddit_comments (author);

-- One extraction = one (comment, restaurant_mention) pair. A single comment
-- can mention multiple restaurants, hence the 1:N from comments to extractions.
-- food_sentiment / service_sentiment are nullable: a comment may discuss
-- only food, only service, or both.
create table if not exists extractions (
  id                 uuid primary key default gen_random_uuid(),
  comment_id         uuid not null references reddit_comments(id) on delete cascade,
  restaurant_id      uuid references restaurants(id) on delete set null,

  -- Raw mention as extracted, before resolution
  mention_text       text not null,
  neighborhood_hint  text,

  -- Aspect sentiments. Nullable when the comment doesn't address that aspect.
  -- 'positive' | 'negative' | 'mixed'
  food_sentiment     text check (food_sentiment in ('positive', 'negative', 'mixed')),
  service_sentiment  text check (service_sentiment in ('positive', 'negative', 'mixed')),

  -- Direct quote from the comment, used to display sample reviews.
  quote_original     text not null,
  quote_translated   text,                     -- English translation when source is non-English

  -- Vote weight for this extraction. 1.0 = unique user, fully confident match.
  -- Diluted (e.g. 0.5) when restaurant resolution is ambiguous (RedditRecs pattern).
  vote_weight        numeric(4, 3) not null default 1.0,

  -- Resolution metadata
  resolution_confidence numeric(3, 2),         -- 0..1
  resolution_method     text,                  -- 'exact' | 'agent' | 'manual' | 'fallback'

  created_at         timestamptz not null default now()
);

create index if not exists extractions_restaurant_idx on extractions (restaurant_id);
create index if not exists extractions_comment_idx on extractions (comment_id);

-- Audit trail of every place-resolution attempt (success or fail). Lets us
-- improve the resolver without losing history.
create table if not exists place_resolutions (
  id              uuid primary key default gen_random_uuid(),
  mention_text    text not null,
  city_slug       text not null references cities(slug),
  candidate_place_id text,
  confidence      numeric(3, 2),
  method          text not null,
  reasoning       text,
  resolved_at     timestamptz not null default now()
);

-- Admin reconciliation queue. The pipeline writes here when confidence is
-- low or when duplicates / spam are suspected.
create table if not exists flags (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,        -- 'low_confidence_match' | 'possible_duplicate' | 'possible_spam' | 'ambiguous_name'
  extraction_id uuid references extractions(id) on delete cascade,
  restaurant_id uuid references restaurants(id) on delete cascade,
  details       jsonb not null default '{}'::jsonb,
  status        text not null default 'open'
                check (status in ('open', 'resolved', 'dismissed')),
  resolved_by   text,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists flags_status_idx on flags (status);

-- Materialized scores per restaurant. Recomputed at the end of each pipeline
-- run from the extractions table. Kept separate so live queries don't
-- aggregate millions of rows on every page load.
--
-- Scoring (per RedditRecs-derived approach):
--   food_score    = 0.75 * food_positive_rate    + 0.25 * food_pos_to_neg_ratio_normalized
--   service_score = 0.75 * service_positive_rate + 0.25 * service_pos_to_neg_ratio_normalized
-- Vote counts use vote_weight (so ambiguous mentions count fractionally).
create table if not exists restaurant_scores (
  restaurant_id     uuid primary key references restaurants(id) on delete cascade,

  food_score        numeric(4, 3),
  food_positive     numeric(8, 3) not null default 0,
  food_negative     numeric(8, 3) not null default 0,
  food_unique_users integer not null default 0,

  service_score        numeric(4, 3),
  service_positive     numeric(8, 3) not null default 0,
  service_negative     numeric(8, 3) not null default 0,
  service_unique_users integer not null default 0,

  /** Total unique reviewers (food OR service). Used for "volume" sort. */
  total_unique_users integer not null default 0,

  /** Position in this city's ranked list, recomputed each refresh. */
  city_rank          integer,

  computed_at        timestamptz not null default now()
);

create index if not exists restaurant_scores_city_rank_idx
  on restaurant_scores (city_rank);

-- Seed the four launch cities. Idempotent: re-running the migration leaves
-- existing rows untouched. Keep in sync with lib/cities.ts.
insert into cities (slug, name, country, language, center_lng, center_lat) values
  ('denver',      'Denver',      'USA',    'en', -104.9903, 39.7392),
  ('new-orleans', 'New Orleans', 'USA',    'en',  -90.0715, 29.9511),
  ('calgary',     'Calgary',     'Canada', 'en', -114.0719, 51.0447),
  ('paris',       'Paris',       'France', 'fr',    2.3522, 48.8566)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- The anon key is exposed to browsers, so any unprotected table is publicly
-- readable. RLS denies all access by default once enabled; we then grant
-- explicit SELECT policies to the three tables that drive the public
-- frontend. The Python pipeline uses the service-role key, which bypasses
-- RLS entirely, so writes are unaffected.
--
-- Internal tables (reddit_threads, reddit_comments, extractions,
-- place_resolutions, flags) have RLS enabled with NO policies, meaning the
-- anon/authenticated keys cannot read them. They're accessed only by the
-- pipeline (service role) and the /admin page (server-side, also service role).

alter table cities             enable row level security;
alter table restaurants        enable row level security;
alter table restaurant_scores  enable row level security;
alter table reddit_threads     enable row level security;
alter table reddit_comments    enable row level security;
alter table extractions        enable row level security;
alter table place_resolutions  enable row level security;
alter table flags              enable row level security;

-- Public read policies. drop-then-create keeps this idempotent on re-run.
drop policy if exists "public read cities"            on cities;
drop policy if exists "public read restaurants"       on restaurants;
drop policy if exists "public read restaurant_scores" on restaurant_scores;

create policy "public read cities"
  on cities             for select to anon, authenticated using (true);
create policy "public read restaurants"
  on restaurants        for select to anon, authenticated using (true);
create policy "public read restaurant_scores"
  on restaurant_scores  for select to anon, authenticated using (true);
