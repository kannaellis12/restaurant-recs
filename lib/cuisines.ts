export type Cuisine = {
  slug: string;
  label: string;
};

export const CUISINES: Cuisine[] = [
  { slug: "american-casual", label: "American (Casual)" },
  { slug: "american-fine-dining", label: "American (Fine Dining)" },
  { slug: "bbq", label: "BBQ" },
  { slug: "steakhouse", label: "Steakhouse" },
  { slug: "butcher", label: "Butcher / Charcuterie" },
  { slug: "deli", label: "Deli" },
  { slug: "pizza", label: "Pizza" },
  { slug: "italian", label: "Italian" },
  { slug: "french", label: "French (Bistro / Brasserie)" },
  { slug: "cajun", label: "Cajun" },
  { slug: "southern", label: "Southern (US)" },
  { slug: "mexican", label: "Mexican" },
  { slug: "mediterranean", label: "Mediterranean" },
  { slug: "spanish", label: "Spanish / Tapas" },
  { slug: "middle-eastern", label: "Middle Eastern" },
  { slug: "chinese", label: "Chinese" },
  { slug: "japanese", label: "Japanese / Sushi" },
  { slug: "ramen", label: "Ramen / Noodle" },
  { slug: "korean", label: "Korean" },
  { slug: "thai", label: "Thai" },
  { slug: "vietnamese", label: "Vietnamese" },
  { slug: "indian", label: "Indian" },
  { slug: "ethiopian-african", label: "Ethiopian / African" },
  { slug: "seafood", label: "Seafood" },
  { slug: "vegetarian-vegan", label: "Vegetarian / Vegan" },
  { slug: "brunch-breakfast", label: "Brunch / Breakfast" },
  { slug: "bakery-cafe-dessert", label: "Bakery / Cafe / Dessert" },
  { slug: "cocktails", label: "Cocktails" },
  { slug: "bar-gastropub", label: "Bar / Gastropub" },
];

export const CUISINES_BY_SLUG: Record<string, Cuisine> = Object.fromEntries(
  CUISINES.map((c) => [c.slug, c]),
);

/** Maximum cuisine tags allowed per restaurant. */
export const MAX_CUISINES_PER_RESTAURANT = 3;
