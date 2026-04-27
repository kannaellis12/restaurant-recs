"""Subreddit seed lists for the discover stage.

Mirror of config/subreddits.ts — keep in sync if you edit either. The TS
file drives the (future) frontend display + admin UI; this Python file is
what the orchestrator reads. A single-source-of-truth JSON is a future
improvement; for now duplication is acceptable since the lists rarely change.

Two tiers:
  * city-focused subs — assume threads are about the city or its metro
  * global / general subs — large food/travel subs that need a city
    keyword pre-filter before going to the LLM relevance gate
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SubredditSeed:
    name: str
    requires_city_keyword: bool


def _focused(names: list) -> list:
    return [SubredditSeed(name=n, requires_city_keyword=False) for n in names]


def _general(names: list) -> list:
    return [SubredditSeed(name=n, requires_city_keyword=True) for n in names]


SUBREDDITS_BY_CITY: dict[str, list[SubredditSeed]] = {
    # ----- DENVER (metro + Boulder area) -----------------------------------
    "denver": [
        *_focused([
            # Core Denver
            "Denver", "DenverFood", "denverwomen", "DenverMeetups",
            "DenverCirclejerk", "DenverSecrets", "DenverBourbonHunt",
            "DenverAfterDark", "DenverFoodieFriends", "MovingtoDenver",
            "DowntownDenver",
            # Suburbs
            "WestminsterCO", "arvadaco", "auroraco", "lakewoodCO",
            "littletonCO", "centennial", "highlandsranch", "parkercolorado",
            "ENGLEWOODCO", "castlerock",
            # Boulder area
            "boulder", "BoulderColorado",
            # Other Front Range cities
            "longmontcolorado", "FortCollins", "ColoradoSprings",
        ]),
        *_general(["Colorado"]),
    ],

    # ----- NEW ORLEANS -----------------------------------------------------
    # Removed: NewOrleansLocals (dead — last post 4+ years ago)
    "new-orleans": [
        *_focused([
            "NewOrleans", "NOLA", "AskNOLA", "NewOrleansFood",
            "frenchquarter", "metairie", "kenner", "Slidell",
        ]),
        *_general(["Louisiana"]),
    ],

    # ----- PARIS -----------------------------------------------------------
    # Removed: expatsinfrance (NO_POSTS).
    # Added: r/France (huge general sub, keyword-filtered for Paris content).
    "paris": [
        *_focused([
            "paris", "AskParis", "paristravel", "ParisTravelGuide",
            "restoparis", "frenchfood",
        ]),
        *_general(["France"]),
    ],

    # ----- CALGARY ---------------------------------------------------------
    # Removed: calgaryfood (NO_POSTS), chestermere (sub doesn't exist).
    "calgary": [
        *_focused([
            "calgary", "foodcalgary", "YYC", "bettercalgary",
            "calgarysocialclub", "airdrie", "cochrane", "okotoks",
            "Banff", "canmore",
        ]),
        *_general(["alberta", "canada", "edmonton"]),
    ],
}


# Global food / travel subs applied across all cities. Always require the
# city keyword to appear in the thread title or body before the LLM relevance
# gate runs.
#
# Trimmed from 14 → 4 after the Denver deep run: each city's discover spends
# ~$1-2 per global sub on Apify, so 14 globals × 4 cities ≈ $60+ in globals
# alone. These four had the best signal-per-dollar ratio in the Denver run:
#   * finedining        — explicit restaurant recommendations, low noise
#   * restaurants       — general restaurant chatter, medium noise
#   * michelinstars     — by definition names specific places
#   * anthonybourdain   — fan community, often discusses specific restaurants
#
# Cut as too noisy for the cost: travel, food (mostly home cooking),
# eatcheapandhealthy, breadit, restaurateur, restaurantowners, cuisine,
# kitchenconfidential, askfoodhistorians, restaurant.
GLOBAL_SUBS: list[SubredditSeed] = _general([
    "finedining",
    "restaurants",
    "michelinstars",
    "anthonybourdain",
])


# Substrings used to keyword-filter threads from `requires_city_keyword=True`
# subs. Case-insensitive substring match against title + body. Mirror of
# CITY_KEYWORDS in config/subreddits.ts.
CITY_KEYWORDS: dict[str, list[str]] = {
    "denver": [
        "denver", "rino", "lodo", "cherry creek", "highlands", "boulder",
        "longmont", "aurora", "arvada", "fort collins", "colorado springs",
    ],
    "new-orleans": [
        "new orleans", "nola", "french quarter", "uptown nola", "marigny",
        "treme", "bywater", "garden district", "metairie", "kenner",
    ],
    "paris": [
        "paris", "parisian", "parisien", "île-de-france", "ile-de-france",
    ],
    "calgary": [
        "calgary", "yyc", "kensington calgary", "inglewood calgary",
        "airdrie", "cochrane", "canmore", "banff",
    ],
}
