-- Vibe / occasion tags for restaurants.
--
-- Tags differ from cuisines: cuisines come from Google Places types and
-- describe what kind of food the place serves. Tags come from Reddit
-- threads + comments and describe the vibe / occasion the restaurant is
-- right for ("date_night", "hidden_gem", "great_views").
--
-- The closed taxonomy (enforced by the LLM extract prompt, not the DB) is:
--   date_night, hidden_gem, hole_in_the_wall, great_views, cheap_eats,
--   special_occasion, late_night, outdoor_seating
--
-- Per-extraction tags live on `extractions.tags`. Per-restaurant tags are
-- aggregated by the score stage and live on `restaurant_scores.tags` —
-- a tag is "stuck" on a restaurant only if at least 2 extractions
-- reference it (single-mention noise filter).

alter table extractions
  add column if not exists tags text[] not null default '{}';

create index if not exists extractions_tags_gin
  on extractions using gin (tags);

alter table restaurant_scores
  add column if not exists tags text[] not null default '{}';

create index if not exists restaurant_scores_tags_gin
  on restaurant_scores using gin (tags);

-- Recreate the read-side view so the frontend gets `tags` in the same
-- single-query select that already returns scores.
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
  -- `tags` MUST be appended at the end. CREATE OR REPLACE VIEW only allows
  -- adding columns at the tail; inserting one earlier triggers Postgres
  -- error 42P16 ("cannot change name of view column").
  coalesce(s.tags, '{}')              as tags
from restaurants r
left join restaurant_scores s on s.restaurant_id = r.id;

grant select on restaurants_with_scores to anon, authenticated;
