import "server-only";

/**
 * Server-only Google Places API helpers used by the /admin manual reassign
 * flow. NEVER import from a client component — uses a server-side API key.
 */

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places";

const FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "priceLevel",
  "websiteUri",
  "rating",
  "userRatingCount",
  "types",
  "businessStatus",
].join(",");

const PLACES_FIELD_MASK = FIELD_MASK.split(",")
  .map((f) => `places.${f}`)
  .join(",");

const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE: 1,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export type PlaceLite = {
  placeId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  priceLevel: number | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  types: string[];
  /** OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY | null */
  businessStatus: string | null;
};

function key(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  if (!k) throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
  return k;
}

function rawToLite(raw: Record<string, unknown>): PlaceLite {
  const display = (raw.displayName ?? {}) as { text?: string };
  const loc = (raw.location ?? {}) as { latitude?: number; longitude?: number };
  const priceRaw = raw.priceLevel as string | undefined;
  return {
    placeId: String(raw.id ?? ""),
    name: display.text ?? "",
    address: (raw.formattedAddress as string | undefined) ?? null,
    lat: loc.latitude ?? 0,
    lng: loc.longitude ?? 0,
    priceLevel: priceRaw ? (PRICE_LEVEL_MAP[priceRaw] ?? null) : null,
    website: (raw.websiteUri as string | undefined) ?? null,
    rating: (raw.rating as number | undefined) ?? null,
    reviewCount: (raw.userRatingCount as number | undefined) ?? null,
    types: (raw.types as string[] | undefined) ?? [],
    businessStatus: (raw.businessStatus as string | undefined) ?? null,
  };
}

/**
 * Text-search Google Places with a city-biased radius. Used by /admin to find
 * candidates when the pipeline's resolver got it wrong.
 */
export async function searchPlaces(
  query: string,
  cityCenter: [lng: number, lat: number],
  options: { radiusM?: number; max?: number } = {},
): Promise<PlaceLite[]> {
  const { radiusM = 50_000, max = 5 } = options;
  const r = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key(),
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: {
        circle: {
          center: { longitude: cityCenter[0], latitude: cityCenter[1] },
          radius: radiusM,
        },
      },
      maxResultCount: max,
    }),
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(
      `Places searchText failed: ${r.status} ${(await r.text()).slice(0, 200)}`,
    );
  }
  const data = (await r.json()) as { places?: Record<string, unknown>[] };
  return (data.places ?? []).map(rawToLite);
}

/**
 * Fetch one place by its Google Place ID. Used after the user picks a search
 * result so we have everything needed to upsert into `restaurants`.
 */
export async function fetchPlaceById(placeId: string): Promise<PlaceLite> {
  const r = await fetch(`${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": key(),
      "X-Goog-FieldMask": FIELD_MASK,
    },
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(
      `Places details failed: ${r.status} ${(await r.text()).slice(0, 200)}`,
    );
  }
  const raw = (await r.json()) as Record<string, unknown>;
  return rawToLite(raw);
}
