-- URL-friendly slugs for restaurants. Detail pages move from
-- /[city]/[placeId] (opaque "ChIJ...") to /[city]/[slug] (readable
-- "septime", "bull-and-bush").
--
-- Conflict policy: when two restaurants in the same city slugify to
-- the same base (e.g. Corvus Coffee × 3 in Denver), append
-- `-{place_id}` to disambiguate. The placeId tail is always unique
-- so no further dedup is needed. Restaurants with a unique base slug
-- get the clean form.
--
-- The pipeline writes restaurants via `upsert_restaurant`, but the
-- /admin route updates them with a plain `.update()` — both code
-- paths are covered by the BEFORE INSERT/UPDATE trigger below, so we
-- don't have to duplicate slug logic in app code.

-- pg_unaccent strips diacritics so e.g. "Crème" → "creme" instead of
-- "cr-me". Available on Supabase but not enabled by default.
create extension if not exists unaccent;

-- Lowercase, strip accents, collapse non-alphanumeric to hyphens, trim.
create or replace function slugify(input text) returns text as $$
  select trim(both '-' from regexp_replace(
    lower(unaccent(input)),
    '[^a-z0-9]+', '-', 'g'
  ));
$$ language sql immutable;

alter table restaurants
  add column if not exists slug text;

-- Pass 1: rows whose name conflicts with at least one other row in
-- the same city → slug includes the placeId tail.
update restaurants r
set slug = slugify(r.name) || '-' || r.place_id
where r.slug is null
  and exists (
    select 1 from restaurants r2
    where r2.city_slug = r.city_slug
      and slugify(r2.name) = slugify(r.name)
      and r2.id != r.id
  );

-- Pass 2: every remaining row (no name conflict in its city) gets
-- the clean slug.
update restaurants
set slug = slugify(name)
where slug is null;

alter table restaurants
  alter column slug set not null;

create unique index if not exists restaurants_city_slug_slug_idx
  on restaurants(city_slug, slug);

-- Trigger keeps slug in sync with name on insert + on rename. We only
-- recompute when the name actually changes (or slug is missing), so
-- a no-op admin update doesn't churn URLs.
create or replace function set_restaurant_slug() returns trigger as $$
declare
  base text;
  has_conflict boolean;
begin
  if TG_OP = 'UPDATE' and NEW.name = OLD.name and NEW.slug is not null then
    return NEW;
  end if;

  base := slugify(NEW.name);

  -- A name conflict exists if any OTHER row in the same city already
  -- has the exact same base slug or the suffixed variant. In either
  -- case we apply the placeId suffix to NEW so the URL is unique.
  select exists(
    select 1 from restaurants
    where city_slug = NEW.city_slug
      and id != NEW.id
      and slug = base
  ) into has_conflict;

  if has_conflict then
    NEW.slug := base || '-' || NEW.place_id;
  else
    NEW.slug := base;
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists restaurants_slug_trigger on restaurants;
create trigger restaurants_slug_trigger
  before insert or update on restaurants
  for each row execute function set_restaurant_slug();

-- Surface slug on the read-side view used by the frontend.
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
  -- Appended last per CREATE OR REPLACE VIEW column-rename rules.
  r.slug
from restaurants r
left join restaurant_scores s on s.restaurant_id = r.id;

grant select on restaurants_with_scores to anon, authenticated;
