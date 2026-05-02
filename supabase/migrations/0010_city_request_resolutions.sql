-- Tracks which city requests have been "done" (the city has actually
-- been added to the editorial set, or the admin has otherwise decided
-- the request is closed).
--
-- Stored as a separate keyed-by-place_id table rather than a column on
-- city_requests because we want a SINGLE resolution per place — even
-- as new request rows pile up after a city's been added (visitors who
-- bookmarked the request flow). One resolution covers the whole pile.
--
-- No anon access. The admin page reads + writes via the service role.

create table if not exists city_request_resolutions (
  place_id    text primary key,
  resolved_at timestamptz not null default now(),
  resolved_by text
);

alter table city_request_resolutions enable row level security;
-- (No policies = service-role-only access. The anon and authenticated
-- roles can't read or write this table at all.)
