-- Helper RPCs the Python pipeline calls. Apply after 0001_init.sql.
--
-- Why this exists: PostgREST (the REST API in front of Postgres) can't
-- accept a PostGIS `geography` value in JSON. So the pipeline can't insert
-- into `restaurants.geog` directly via the supabase-py client. This RPC
-- takes plain lng/lat floats and constructs the geography internally.
--
-- The function is idempotent: ON CONFLICT (place_id) updates fields that
-- can change over time (rating, review count, etc.) without recreating the
-- row's UUID, so foreign keys from extractions/scores stay intact.

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
    name             = excluded.name,
    -- Keep an existing neighborhood if the new resolution didn't supply one
    neighborhood     = coalesce(excluded.neighborhood, restaurants.neighborhood),
    address          = excluded.address,
    website          = excluded.website,
    price_level      = excluded.price_level,
    google_rating    = excluded.google_rating,
    google_review_ct = excluded.google_review_ct,
    geog             = excluded.geog,
    -- Don't blow away cuisines if the caller passed an empty array
    cuisines         = case
                         when array_length(excluded.cuisines, 1) > 0 then excluded.cuisines
                         else restaurants.cuisines
                       end,
    updated_at       = now()
  returning id into v_id;
  return v_id;
end;
$$;
