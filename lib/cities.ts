export type City = {
  slug: string;
  name: string;
  country: string;
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
    center: [-104.9903, 39.7392],
    zoom: 11,
    language: "en",
  },
  {
    slug: "new-orleans",
    name: "New Orleans",
    country: "USA",
    center: [-90.0715, 29.9511],
    zoom: 11,
    language: "en",
  },
  {
    slug: "calgary",
    name: "Calgary",
    country: "Canada",
    center: [-114.0719, 51.0447],
    zoom: 11,
    language: "en",
  },
  {
    slug: "paris",
    name: "Paris",
    country: "France",
    center: [2.3522, 48.8566],
    zoom: 12,
    language: "fr",
  },
];

export const CITIES_BY_SLUG: Record<string, City> = Object.fromEntries(
  CITIES.map((c) => [c.slug, c]),
);
