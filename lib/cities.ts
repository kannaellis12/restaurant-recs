export type Region = "North America" | "Europe";

/** Display order for the homepage's region sections. */
export const REGIONS: Region[] = ["North America", "Europe"];

export type City = {
  slug: string;
  name: string;
  country: string;
  /** Continent grouping for the homepage's regional sections. */
  region: Region;
  /** Centroid used for the default map view. [longitude, latitude] (Mapbox order) */
  center: [number, number];
  /** Default zoom for the city map */
  zoom: number;
  /** Primary language of Reddit content for this city. Used to drive translation. */
  language: "en" | "fr";
};

export const CITIES: City[] = [
  {
    slug: "denver",
    name: "Denver",
    country: "USA",
    region: "North America",
    center: [-104.9903, 39.7392],
    zoom: 11,
    language: "en",
  },
  {
    slug: "new-orleans",
    name: "New Orleans",
    country: "USA",
    region: "North America",
    center: [-90.0715, 29.9511],
    zoom: 11,
    language: "en",
  },
  {
    slug: "calgary",
    name: "Calgary",
    country: "Canada",
    region: "North America",
    center: [-114.0719, 51.0447],
    zoom: 11,
    language: "en",
  },
  {
    slug: "paris",
    name: "Paris",
    country: "France",
    region: "Europe",
    center: [2.3522, 48.8566],
    zoom: 12,
    language: "fr",
  },
  {
    slug: "seattle",
    name: "Seattle",
    country: "USA",
    region: "North America",
    center: [-122.3321, 47.6062],
    zoom: 11,
    language: "en",
  },
  {
    slug: "brooklyn",
    name: "Brooklyn",
    country: "USA",
    region: "North America",
    // Brooklyn is a dense NYC borough — a tighter default zoom than the
    // sprawling metros so the initial view isn't mostly water + Manhattan.
    center: [-73.9442, 40.6782],
    zoom: 12,
    language: "en",
  },
  {
    slug: "austin",
    name: "Austin",
    country: "USA",
    region: "North America",
    center: [-97.7431, 30.2672],
    zoom: 11,
    language: "en",
  },
  {
    slug: "omaha",
    name: "Omaha",
    country: "USA",
    region: "North America",
    center: [-95.9345, 41.2565],
    zoom: 11,
    language: "en",
  },
  {
    slug: "stockholm",
    name: "Stockholm",
    country: "Sweden",
    region: "Europe",
    center: [18.0686, 59.3293],
    // English-language Reddit threads (r/sweden etc.) — enough coverage that
    // no translation step is needed. Same for Tallinn below.
    language: "en",
    zoom: 11,
  },
  {
    slug: "tallinn",
    name: "Tallinn",
    country: "Estonia",
    region: "Europe",
    center: [24.7536, 59.437],
    zoom: 11,
    language: "en",
  },
];

export const CITIES_BY_SLUG: Record<string, City> = Object.fromEntries(
  CITIES.map((c) => [c.slug, c]),
);
