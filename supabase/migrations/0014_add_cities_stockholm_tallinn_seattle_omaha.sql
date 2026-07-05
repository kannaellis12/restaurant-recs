-- Seed four new cities for hand-curated thread ingestion.
--
-- reddit_threads.city_slug (and later restaurants.city_slug) references
-- cities(slug), so these rows must exist before import_threads / the pipeline
-- can write anything for them.
--
-- These stay off the public homepage until they have restaurant data — the
-- frontend city list (lib/cities.ts) is deliberately NOT updated yet. Stockholm
-- and Tallinn ride on English-language Reddit threads, so language = 'en'.
insert into cities (slug, name, country, language, center_lng, center_lat) values
  ('stockholm', 'Stockholm', 'Sweden',  'en',  18.0686, 59.3293),
  ('tallinn',   'Tallinn',   'Estonia', 'en',  24.7536, 59.4370),
  ('seattle',   'Seattle',   'USA',     'en', -122.3321, 47.6062),
  ('omaha',     'Omaha',     'USA',     'en',  -95.9345, 41.2565)
on conflict (slug) do nothing;
