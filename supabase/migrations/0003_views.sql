-- Read-side view used by the Next.js frontend.
--
-- Two reasons this view exists:
--   1. PostgREST can't serialize PostGIS `geography` columns into useful JSON,
--      so we expose lng/lat as separate floats via st_x / st_y.
--   2. The frontend needs restaurants joined with their scores in one query.
--      Doing it as a view keeps the page component a single .select() call.
--
-- security_invoker = true makes the view honor the caller's RLS context
-- (anon vs service_role), inheriting the policies on restaurants and
-- restaurant_scores rather than the view creator's privileges.

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
  s.city_rank
from restaurants r
left join restaurant_scores s on s.restaurant_id = r.id;

-- Allow anon + authenticated to read the view. Underlying-table policies
-- already grant the same; this is belt-and-suspenders for some clients
-- that check view-level grants explicitly.
grant select on restaurants_with_scores to anon, authenticated;
