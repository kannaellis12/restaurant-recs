# Reddit Restaurants

Restaurant rankings sourced from real Reddit reviews. Food first, not service complaints.

Modeled after [RedditRecs](https://redditrecs.com/) but for restaurants, with an interactive map and per-city rankings.

## Cities (v1)

- Denver
- New Orleans
- Calgary
- Paris

Refreshed annually. Reviews older than 24 months are dropped.

## Stack

- **Frontend**: Next.js (App Router) + Tailwind + Mapbox GL on Vercel
- **Database**: Supabase (Postgres + PostGIS)
- **Pipeline**: Python (PRAW + Anthropic + Google Places). See [`pipeline/README.md`](pipeline/README.md).

## Getting started

```bash
# Install web deps
npm install

# Copy env template and fill in keys
cp .env.local.example .env.local

# Run the dev server
npm run dev
```

## Pipeline

See [`pipeline/README.md`](pipeline/README.md). It's a separate Python project that
writes results to the same Supabase database the web app reads from.

## Repo layout

```
app/                   Next.js App Router
lib/                   Shared TS code (cities, cuisines, db client)
config/                Static config (subreddit seeds)
pipeline/              Python ingestion + scoring pipeline
supabase/migrations/   Postgres schema migrations
```
