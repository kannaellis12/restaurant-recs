-- Seed two more cities for hand-curated thread ingestion (same rationale as
-- migration 0014). reddit_threads.city_slug references cities(slug), so these
-- rows must exist before import_threads / the pipeline can write for them.
--
-- Held off the public homepage (lib/cities.ts) until they have restaurant data.
-- Brooklyn is a NYC borough centered on the borough itself, not all of NYC.
insert into cities (slug, name, country, language, center_lng, center_lat) values
  ('brooklyn', 'Brooklyn', 'USA', 'en', -73.9442, 40.6782),
  ('austin',   'Austin',   'USA', 'en', -97.7431, 30.2672)
on conflict (slug) do nothing;
