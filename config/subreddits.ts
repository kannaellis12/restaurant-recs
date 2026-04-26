/**
 * Subreddit seed lists for the discovery step of the pipeline.
 *
 * Two tiers:
 *  - per-city subs (focused — assume threads are about that city)
 *  - global food/travel subs (very large/general — keyword-filter for
 *    the city name BEFORE the LLM relevance gate to control LLM spend)
 *
 * The pipeline auto-discovers additional subs (via Reddit search for
 * "[city] food" type queries) and merges them in. Dead/private subs are
 * logged and skipped silently.
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
  denver: [
    ...cityFocused([
      "Denver",
      "DenverFood",
      "AskDenver",
      "denverwomen",
      "DenverMeetups",
      "DenverCirclejerk",
      "DenverSecrets",
      "DenverBourbonHunt",
      "DenverAfterDark",
      "DenverGamers",
      "MovingtoDenver",
      "DowntownDenver",
      "DenverSmallBusiness",
      "DenverFoodieFriends",
      "WestminsterCO",
      "Denvermusic",
    ]),
    ...general(["Colorado"]),
  ],

  "new-orleans": cityFocused([
    "NewOrleans",
    "NOLA",
    "AskNOLA",
    "NewOrleansLocals",
    "NewOrleansFood",
  ]),

  paris: cityFocused([
    "paris",
    "paristravel",
    "paristravelguide",
    "theparisianguide",
    "restoparis",
    "socialparis",
    "askparis",
    "expatsinfrance",
    "parisfood",
    "parisfoodguide",
  ]),

  calgary: [
    ...cityFocused([
      "calgary",
      "calgaryfood",
      "foodcalgary",
      "calgarysocialclub",
      "norulescalgary",
      "ottowagood",
      "bettercalgary",
      "YYC",
    ]),
    ...general([
      "canadian",
      "edmonton",
      "canadianidiots",
    ]),
  ],
};

/**
 * Global food / travel subs applied to ALL cities. Always require the city
 * keyword to appear in the thread title or body before relevance gating.
 */
export const GLOBAL_SUBREDDITS: SubredditSeed[] = general([
  "finedining",
  "travel",
  "restaurant",
  "michelinstars",
  "cuisine",
  "restaurateur",
  "restaurantowners",
  "eatcheapandhealthy",
  "breadit",
  "kitchenconfidential",
  "askfoodhistorians",
  "restaurants",
  "food",
  "anthonybourdain",
]);

/**
 * Substrings used to keyword-filter threads from `requiresCityKeyword: true`
 * subs. Case-insensitive substring match against title + body.
 */
export const CITY_KEYWORDS: Record<string, string[]> = {
  denver: ["denver", "rino", "lodo", "cherry creek", "highlands", "boulder-area"],
  "new-orleans": [
    "new orleans",
    "nola",
    "french quarter",
    "uptown nola",
    "marigny",
    "treme",
    "bywater",
    "garden district",
  ],
  paris: ["paris", "parisian", "île-de-france", "ile-de-france"],
  calgary: ["calgary", "yyc", "kensington calgary", "inglewood calgary"],
};
