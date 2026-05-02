import { NextResponse, type NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Records a "please add my city" request from a marketing surface
 * (homepage / /[city] footer / detail-page footer). The frontend
 * submits a Mapbox Geocoding feature it picked from the typeahead;
 * we trust the place_id since the input is locked to suggestions.
 *
 * The anon key is enough because the table's RLS policy permits
 * insert-only for `anon`. Reads happen elsewhere (admin page,
 * service-role).
 */
type Body = {
  place_id?: unknown;
  place_name?: unknown;
  city?: unknown;
  region?: unknown;
  country?: unknown;
  longitude?: unknown;
  latitude?: unknown;
};

const isString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 200;
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isString(body.place_id) || !isString(body.place_name) || !isString(body.city)) {
    return NextResponse.json(
      { error: "place_id, place_name, and city are required." },
      { status: 400 },
    );
  }

  const row = {
    place_id: body.place_id,
    place_name: body.place_name,
    city: body.city,
    region: isString(body.region) ? body.region : null,
    country: isString(body.country) ? body.country : null,
    longitude: isNum(body.longitude) ? body.longitude : null,
    latitude: isNum(body.latitude) ? body.latitude : null,
  };

  const { error } = await supabase.from("city_requests").insert(row);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
