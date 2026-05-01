-- Restaurant opening hours sourced from Google Places (`regularOpeningHours`).
--
-- Stored as raw jsonb so we can lift either the pre-formatted display
-- lines (`weekdayDescriptions`) or the structured `periods` later. Shape
-- mirrors what Google returns:
--
--   {
--     "weekdayDescriptions": [
--       "Monday: 9:00 AM – 10:00 PM", "Tuesday: ...", ...
--     ],
--     "periods": [
--       { "open": {"day": 0, "hour": 9, "minute": 0},
--         "close": {"day": 0, "hour": 22, "minute": 0} }, ...
--     ],
--     "openNow": true
--   }
--
-- Existing rows get NULL until the next pipeline pass (or a backfill).

alter table restaurants
  add column if not exists hours jsonb;

-- Extend the upsert function to take hours. Default null preserves the
-- existing behavior — callers that don't care about hours don't have to
-- pass anything. ON CONFLICT keeps the existing value when the new call
-- is null (so a partial re-resolve doesn't wipe a previously-fetched set).
create or replace function upsert_restaurant(
  p_place_id          text,
  p_name              text,
  p_city_slug         text,
  p_lng               double precision,
  p_lat               double precision,
  p_neighborhood      text default null,
  p_address           text default null,
  p_website           text default null,
  p_price_level       smallint default null,
  p_google_rating     numeric default null,
  p_google_review_ct  integer default null,
  p_cuisines          text[] default '{}',
  p_hours             jsonb default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  insert into restaurants (
    place_id, name, city_slug, neighborhood, address, website,
    price_level, google_rating, google_review_ct, geog, cuisines, hours
  ) values (
    p_place_id, p_name, p_city_slug, p_neighborhood, p_address, p_website,
    p_price_level, p_google_rating, p_google_review_ct,
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    p_cuisines, p_hours
  )
  on conflict (place_id) do update set
    name             = excluded.name,
    neighborhood     = coalesce(excluded.neighborhood, restaurants.neighborhood),
    address          = excluded.address,
    website          = excluded.website,
    price_level      = excluded.price_level,
    google_rating    = excluded.google_rating,
    google_review_ct = excluded.google_review_ct,
    geog             = excluded.geog,
    cuisines         = case
                         when array_length(excluded.cuisines, 1) > 0 then excluded.cuisines
                         else restaurants.cuisines
                       end,
    -- Preserve existing hours when the upsert doesn't supply new ones
    -- (e.g. a re-resolve where we didn't request opening_hours).
    hours            = coalesce(excluded.hours, restaurants.hours),
    updated_at       = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Recreate the read-side view so the frontend gets `hours` in the same
-- single-query select. CREATE OR REPLACE only allows appending columns
-- at the end, so `hours` goes after `tags` (which itself is the most
-- recently appended column from migration 0006).
create or replace view restaurants_with_scores
with (security_invoker = true)
as
select
  r.id,
  r.place_id,
  r.name,
  r.city_slug,
  r.neighborhood,
  r.address,
  r.website,
  r.price_level,
  r.cuisines,
  r.closed,
  st_x(r.geog::geometry) as lng,
  st_y(r.geog::geometry) as lat,
  s.food_score,
  coalesce(s.food_unique_users, 0)    as food_unique_users,
  s.service_score,
  coalesce(s.service_unique_users, 0) as service_unique_users,
  coalesce(s.total_unique_users, 0)   as total_unique_users,
  s.city_rank,
  coalesce(s.tags, '{}')              as tags,
  -- New: appended last per CREATE OR REPLACE VIEW column-rename rules
  -- (see 0006_tags.sql for the same gotcha).
  r.hours
from restaurants r
left join restaurant_scores s on s.restaurant_id = r.id;

grant select on restaurants_with_scores to anon, authenticated;
