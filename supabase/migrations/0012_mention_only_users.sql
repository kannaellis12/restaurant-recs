-- Track bare-name mentions under neutral search threads as a volume
-- signal. Previously these were skipped (extract.py rule 6: "neutral
-- search threads → bare-name comments here are neutral and should be
-- SKIPPED entirely"). Skipping lost real evidence that a place was on
-- people's minds, even when no sentiment was expressed.
--
-- New behavior: those comments are extracted with food_sentiment=null
-- AND service_sentiment=null. They contribute nothing to food_score or
-- service_score (no positive/negative votes), but they roll up into a
-- new mention_only_users counter. That counter:
--   1. surfaces on the restaurant card as "+ N more mentions"
--   2. gets added to total_unique_users so popular-but-unscored places
--      get a small bump on the volume tiebreak in city_rank.

alter table restaurant_scores
  add column if not exists mention_only_users integer not null default 0;

-- Re-expose the read-side view with the new column appended last
-- (CREATE OR REPLACE VIEW requires preserving existing column order).
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
  r.hours,
  r.slug,
  -- Appended last per CREATE OR REPLACE VIEW column-rename rules.
  coalesce(s.mention_only_users, 0)   as mention_only_users
from restaurants r
left join restaurant_scores s on s.restaurant_id = r.id;

grant select on restaurants_with_scores to anon, authenticated;
