-- City requests: anonymous "I'd like Restaurants of Reddit to cover X"
-- submissions from the marketing surfaces (homepage, /[city] footer,
-- detail-page footer). One row per click. Keeping it row-per-request
-- (rather than aggregating into a count) gives the admin full freedom
-- to chart timing, recent surges, etc., without a backfill later.
--
-- Source identity comes from a Mapbox Geocoding place_id, which is
-- stable per city across the Mapbox catalog. The frontend is locked
-- to Mapbox suggestions (no free-fill) so place_id is always set.
-- city/region/country are denormalized from Mapbox's `context`
-- payload so the admin view doesn't have to hit Mapbox again to
-- render readable labels.
--
-- Dedup intent: the frontend writes a `requested_place_ids` list to
-- localStorage and disables a re-submit for the same place. We do
-- NOT enforce this server-side — multiple browsers (e.g. household)
-- requesting the same city is a real signal we want to count.

create table if not exists city_requests (
  id          uuid primary key default gen_random_uuid(),
  place_id    text not null,
  place_name  text not null,
  city        text not null,
  region      text,
  country     text,
  longitude   double precision,
  latitude    double precision,
  created_at  timestamptz not null default now()
);

create index if not exists city_requests_place_id_idx
  on city_requests(place_id);

create index if not exists city_requests_created_at_idx
  on city_requests(created_at desc);

alter table city_requests enable row level security;

-- The site is unauthenticated for visitors, so the public "anon"
-- role needs to be able to insert. There's no read policy for anon
-- — only the service-role (admin page) can read the queue.
drop policy if exists "anon can insert city requests" on city_requests;
create policy "anon can insert city requests"
  on city_requests
  for insert
  to anon, authenticated
  with check (true);
