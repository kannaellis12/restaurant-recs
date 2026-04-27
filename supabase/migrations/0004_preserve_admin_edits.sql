-- Update upsert_restaurant() to preserve admin-edited fields on subsequent
-- pipeline runs. Apply after 0002.
--
-- Background: the original function (in 0002) overwrote cuisines /
-- neighborhood / price_level / website on every conflict-update. That meant
-- a second pipeline run would clobber any manual edits an admin made via
-- /admin (the editor exposes those four fields). After this migration:
--
--   * cuisines, neighborhood, price_level, website are set on FIRST INSERT
--     (from Google's data) and then become admin-only. Pipeline reruns
--     don't touch them — admin edits survive.
--   * name, address, google_rating, google_review_ct, geog continue to
--     refresh on every run since they're authoritative on Google's side
--     and admin can't edit them.

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
  p_cuisines          text[] default '{}'
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  insert into restaurants (
    place_id, name, city_slug, neighborhood, address, website,
    price_level, google_rating, google_review_ct, geog, cuisines
  ) values (
    p_place_id, p_name, p_city_slug, p_neighborhood, p_address, p_website,
    p_price_level, p_google_rating, p_google_review_ct,
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    p_cuisines
  )
  on conflict (place_id) do update set
    -- Google-authoritative fields refresh on every run.
    name             = excluded.name,
    address          = coalesce(excluded.address, restaurants.address),
    google_rating    = excluded.google_rating,
    google_review_ct = excluded.google_review_ct,
    geog             = excluded.geog,
    updated_at       = now()
    -- Intentionally NOT updated: neighborhood, website, price_level,
    -- cuisines. These are admin-editable via /admin and re-running the
    -- pipeline must not clobber manual curation.
  returning id into v_id;
  return v_id;
end;
$$;
