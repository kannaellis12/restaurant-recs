/**
 * Subreddit seed lists for the discovery step of the pipeline.
 *
 * Two tiers:
 *  - per-city subs (focused — assume threads are about that city or its metro)
 *  - global food/travel subs (very large/general — keyword-filter for
 *    the city name BEFORE the LLM relevance gate to control LLM spend)
 *
 * The pipeline auto-discovers nothing yet; subs we list here are the only
 * input. Dead/private subs return 0 threads and are silently skipped — costs
 * one wasted Apify request, no harm done. After each run, prune any sub that
 * consistently returns 0.
 *
 * Last manual pass: 2026-04-26. Notes inline.
 */

export type SubredditSeed = {
  /** Subreddit name without the leading "r/" */
  name: string;
  /**
   * If true, threads pulled from this sub MUST mention the relevant city
   * (substring match against city name + aliases) before being sent to the
   * LLM relevance gate. Used for large general subs.
   */
  requiresCityKeyword: boolean;
};

const cityFocused = (names: string[]): SubredditSeed[] =>
  names.map((name) => ({ name, requiresCityKeyword: false }));

const general = (names: string[]): SubredditSeed[] =>
  names.map((name) => ({ name, requiresCityKeyword: true }));

export const SUBREDDITS_BY_CITY: Record<string, SubredditSeed[]> = {
  // ---------------------------------------------------------------- DENVER
  // Includes the Denver metro AND Boulder area, since Boulder restaurants
  // (Frasca, Pizzeria Locale's flagship, etc.) routinely get recommended in
  // Denver food discussions and our 50km Places search radius reaches there.
  denver: [
    ...cityFocused([
      // Core Denver
      "Denver",
      "DenverFood",
      "denverwomen",
      "DenverMeetups",
      "DenverCirclejerk",
      "DenverSecrets",
      "DenverBourbonHunt",
      "DenverAfterDark",
      "DenverFoodieFriends",
      "MovingtoDenver",
      "DowntownDenver",
      // Suburbs
      "WestminsterCO",
      "arvadaco",
      "auroraco",
      "lakewoodCO",
      "littletonCO",
      "centennial",
      "highlandsranch",
      "parkercolorado",
      "ENGLEWOODCO",
      "castlerock",
      // Boulder area (tightly connected to Denver food scene)
      "boulder",
      "BoulderColorado",
      // Other Front Range cities frequently mentioned alongside Denver
      "longmontcolorado",
      "FortCollins",
      "ColoradoSprings",
      // Removed: AskDenver (dormant since 2021), Denvermusic (off-topic for food),
      //          DenverGamers (off-topic), DenverSmallBusiness (promotional)
    ]),
    ...general(["Colorado"]),
  ],

  // ----------------------------------------------------------- NEW ORLEANS
  "new-orleans": [
    ...cityFocused([
      "NewOrleans",
      "NOLA",
      "AskNOLA",
      "NewOrleansLocals",
      "NewOrleansFood",
      // Neighborhoods / quarters with their own subs
      "frenchquarter",
      // Suburbs / metro
      "metairie",
      "kenner",
      "Slidell",
    ]),
    ...general(["Louisiana"]),
  ],

  // ---------------------------------------------------------------- PARIS
  paris: cityFocused([
    "paris", // primary, French-language
    "AskParis",
    "expatsinfrance",
    "paristravel", // English-speaking tourists
    "ParisTravelGuide",
    "restoparis", // restaurants specifically
    "frenchfood",
    // Removed: theparisianguide / parisfoodguide / socialparis (small/uncertain)
  ]),

  // -------------------------------------------------------------- CALGARY
  calgary: [
    ...cityFocused([
      "calgary",
      "calgaryfood",
      "foodcalgary",
      "YYC",
      "bettercalgary",
      "calgarysocialclub",
      // Suburbs / nearby
      "airdrie",
      "cochrane",
      "okotoks",
      "chestermere",
      // Mountain / weekend destinations Calgarians eat at
      "Banff",
      "canmore",
      // Removed: norulescalgary (off-topic chaos), ottowagood (likely typo)
    ]),
    ...general([
      "alberta",
      "canada",
      "edmonton",
    ]),
  ],
};

/**
 * Global food / travel subs applied to ALL cities. Always require the city
 * keyword to appear in the thread title or body before relevance gating.
 *
 * Trimmed from 14 → 4 after the Denver deep run: each city's discover spends
 * ~$1-2 per global sub on Apify, so 14 globals × 4 cities ≈ $60+ in globals
 * alone. These four had the best signal-per-dollar ratio. Mirror of
 * pipeline/subreddits.py::GLOBAL_SUBS.
 */
export const GLOBAL_SUBREDDITS: SubredditSeed[] = general([
  "finedining",
  "restaurants",
  "michelinstars",
  "anthonybourdain",
]);

/**
 * Substrings used to keyword-filter threads from `requiresCityKeyword: true`
 * subs. Case-insensitive substring match against title + body.
 */
export const CITY_KEYWORDS: Record<string, string[]> = {
  denver: [
    "denver",
    "rino",
    "lodo",
    "cherry creek",
    "highlands",
    "boulder",
    "longmont",
    "aurora",
    "arvada",
    "fort collins",
    "colorado springs",
  ],
  "new-orleans": [
    "new orleans",
    "nola",
    "french quarter",
    "uptown nola",
    "marigny",
    "treme",
    "bywater",
    "garden district",
    "metairie",
    "kenner",
  ],
  paris: ["paris", "parisian", "parisien", "île-de-france", "ile-de-france"],
  calgary: [
    "calgary",
    "yyc",
    "kensington calgary",
    "inglewood calgary",
    "airdrie",
    "cochrane",
    "canmore",
    "banff",
  ],
};
