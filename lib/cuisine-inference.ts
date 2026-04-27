import { MAX_CUISINES_PER_RESTAURANT } from "./cuisines";

/**
 * Map Google Places `types` strings to our cuisine slugs.
 *
 * Mirror of pipeline/stages/resolve.py::PLACES_TYPE_TO_CUISINE. Keep these in
 * sync — both the Python pipeline (initial inference) and the Next.js admin
 * (manual reassign) need the same mapping.
 */
const PLACES_TYPE_TO_CUISINE: Record<string, string> = {
  // American
  american_restaurant: "american-casual",
  diner: "american-casual",
  fast_food_restaurant: "american-casual",
  hamburger_restaurant: "american-casual",
  // BBQ
  barbecue_restaurant: "bbq",
  // Steakhouse
  steak_house: "steakhouse",
  // Butcher / Charcuterie
  butcher_shop: "butcher",
  // Deli
  deli: "deli",
  // Pizza
  pizza_restaurant: "pizza",
  // Italian
  italian_restaurant: "italian",
  // French
  french_restaurant: "french",
  // Mexican / Latin
  mexican_restaurant: "mexican",
  taco_restaurant: "mexican",
  // Mediterranean / Greek
  mediterranean_restaurant: "mediterranean",
  greek_restaurant: "mediterranean",
  // Spanish / Tapas
  spanish_restaurant: "spanish",
  // Middle Eastern
  middle_eastern_restaurant: "middle-eastern",
  lebanese_restaurant: "middle-eastern",
  turkish_restaurant: "middle-eastern",
  // East Asian
  chinese_restaurant: "chinese",
  japanese_restaurant: "japanese",
  sushi_restaurant: "japanese",
  ramen_restaurant: "ramen",
  korean_restaurant: "korean",
  thai_restaurant: "thai",
  vietnamese_restaurant: "vietnamese",
  // South Asian
  indian_restaurant: "indian",
  // African
  african_restaurant: "ethiopian-african",
  // Seafood
  seafood_restaurant: "seafood",
  // Vegetarian / Vegan
  vegetarian_restaurant: "vegetarian-vegan",
  vegan_restaurant: "vegetarian-vegan",
  // Brunch / Breakfast
  breakfast_restaurant: "brunch-breakfast",
  brunch_restaurant: "brunch-breakfast",
  // Bakery / Cafe / Dessert
  bakery: "bakery-cafe-dessert",
  cafe: "bakery-cafe-dessert",
  coffee_shop: "bakery-cafe-dessert",
  ice_cream_shop: "bakery-cafe-dessert",
  dessert_shop: "bakery-cafe-dessert",
  donut_shop: "bakery-cafe-dessert",
  // Cocktails (Google's types are sparse — admin tags most manually)
  cocktail_bar: "cocktails",
  // Bar / Gastropub
  bar: "bar-gastropub",
  bar_and_grill: "bar-gastropub",
  pub: "bar-gastropub",
  wine_bar: "bar-gastropub",
};

export function cuisinesFromTypes(types: string[] | null | undefined): string[] {
  if (!types) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of types) {
    const slug = PLACES_TYPE_TO_CUISINE[t];
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
      if (out.length >= MAX_CUISINES_PER_RESTAURANT) break;
    }
  }
  return out;
}
