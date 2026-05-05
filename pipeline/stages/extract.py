"""Extract stage — turn a Reddit comment into a list of restaurant evaluations.

Uses Claude Haiku 4.5 with tool-use for reliable structured output. Each comment
goes in, a list of `Extraction` objects comes out (possibly empty if the comment
isn't actually evaluating any restaurants).

Aspect sentiments (food vs service) are extracted SEPARATELY — that's the whole
product premise. A comment like "great food, terrible service" should produce
food=positive, service=negative, not a single averaged sentiment.
"""
from __future__ import annotations

from typing import Optional

import anthropic

from pipeline.config import settings
from pipeline.models import Extraction


DEFAULT_MODEL = "claude-haiku-4-5-20251001"


_SYSTEM_PROMPT = """\
You extract restaurant EVALUATIONS from a Reddit comment. The comment was \
posted in a city subreddit and may or may not be about restaurants.

The user message may include CONTEXT in addition to the comment body:
  - "Thread title" — the title of the Reddit post the comment is on.
  - "Thread body" — the post's body text (when present).
  - "Reply chain" — comments above this one, closest parent first. The \
current comment is replying to the first item in the chain.

Use the context to resolve evaluations that don't name a restaurant directly:

  1. THREAD TITLE: If it clearly names a specific restaurant ("Has anyone \
been to Tavernetta?" → Tavernetta) and the comment makes an evaluation \
without re-naming it ("Amazing!"), extract using the title's restaurant.
  2. REPLY CHAIN: If a parent comment in the chain named a restaurant \
("Tavernetta is incredible") and this comment evaluates the same one \
without re-naming ("Agreed, their pasta!"), extract using that parent's \
restaurant.
  3. PRECEDENCE: If the current comment names a DIFFERENT restaurant from \
its parent ("I prefer Frasca instead"), use the new one — comments can \
shift subjects.
  4. GENERIC THREADS: DO NOT extract from comments under threads like "Best \
ramen in Denver?" or "Where to get good Mexican?" unless the comment names \
a specific restaurant on its own. Those threads name a category, not a place.
  5. NEVER extract phantom names from the title verbatim ("Best Ramen in \
Denver" is not a restaurant).
  6. THREAD POLARITY: When the thread itself is asking for recommendations \
or pans, a bare-name comment (just a restaurant name, no explicit \
evaluation) inherits the thread's implied sentiment. Treat the title as \
the question the comment is answering:
    - Recommendation threads ("Best date night?", "Favorite tacos?", "Must-try \
restaurants", "Cant-miss spots", "Hidden gems", "Where would you go for \
your last meal", "Restaurants for life") → bare name → food_sentiment=positive
    - Pan threads ("Worst restaurants?", "Most overhyped?", "Avoid which \
restaurants?", "Where NOT to eat") → bare name → food_sentiment=negative
    - Neutral search threads ("Where to find sushi?", "Any good cocktail \
bars near X?", "Open late on Sunday?") → DO NOT infer polarity, but DO \
extract the mention. Bare-name comments here are volume-only signals: \
someone naming the place as an answer is evidence the place is in \
people's minds, even though no sentiment was expressed. OMIT both \
food_sentiment and service_sentiment from the output so the mention is \
recorded without affecting either score.
  When inferring polarity from the thread, set the `quote` to a short \
verbatim snippet of the comment (or the bare name itself if that's all \
there is).

For each distinct restaurant the comment evaluates, record:
  - mention: the restaurant name (verbatim from the comment, OR pulled from \
the thread title when the rules above apply). Don't canonicalize.
  - neighborhood_hint: a neighborhood name mentioned alongside the restaurant \
("Highlands", "RiNo", "Congress Park"). OMIT if not stated.
  - food_sentiment: positive | negative | mixed — about the food specifically, \
OR a broad evaluation of the restaurant that doesn't single out an aspect \
("amazing!", "avoid this place", "wonderful staple", "cesspit"). On a \
restaurant rec site, generic evaluations are food-coded by default — people \
who care about service usually call it out by name. OMIT only when the \
comment is purely about service/atmosphere with no food/overall judgment.
  - service_sentiment: positive | negative | mixed — about service, staff, wait \
times, vibes, ambiance, or atmosphere. OMIT entirely unless the comment \
SPECIFICALLY calls one of those out. Don't infer service from a generic \
positive/negative — that goes in food_sentiment.
  - quote: the most relevant verbatim snippet from the comment that supports \
your judgment (one sentence ideally). NEVER translate this — keep it in \
the original language exactly as written. Copy the exact characters.
  - quote_translated: a LITERAL English translation of the EXACT text in \
`quote`. Strict rules:
      * Translate ONLY the words in `quote`. Do not paraphrase, do not \
summarize, do not pull in other parts of the comment. The translated string \
should be the same content as `quote`, just in English.
      * REQUIRED whenever `quote` contains ANY non-English text — even if \
the quote is short, even if a few words are English-cognate, even if you \
think an English speaker could "mostly" follow. If the quote contains French \
("très", "pour", "c'est", "j'ai"), Spanish, Italian, etc., translate.
      * OMIT only when `quote` is 100% English. Never echo the source \
verbatim into this field.
      * Preserve tone (slangy stays slangy, formal stays formal). Translate \
proper nouns (restaurant names, neighborhoods) as-is — don't anglicize them.
  - tags: vibe/occasion descriptors drawn from this CLOSED taxonomy:
      * date_night        — romantic, intimate, suited for couples
      * hidden_gem        — locals' pick, off the tourist track, "you'd never know it was here"
      * hole_in_the_wall  — unassuming exterior, dive vibe, surprisingly good
      * great_views       — rooftop, scenic, terrace with a view, panoramic
      * cheap_eats        — budget-friendly, affordable, "won't break the bank"
      * special_occasion  — splurge, anniversary, fine dining ambiance, celebration
      * late_night        — open late, post-show, after-hours
      * outdoor_seating   — patio, terrace, garden, sidewalk seating
    Apply a tag when EITHER (a) the thread itself is about that vibe ("Best \
date night spots in Paris" → date_night) OR (b) the comment text directly \
describes the restaurant that way ("rooftop with the most amazing view" → \
great_views). Use the empty list if nothing applies. Don't invent tags \
outside this list.

Strict rules:
  - Only extract EVALUATIONS (positive or negative judgments). Skip neutral \
mentions like "I went to X last week" or "X is on 16th street". EXCEPTIONS \
(see rule 6):
      * Recommendation or pan thread + bare name → extract with the \
thread-implied sentiment.
      * Neutral search thread + bare name → extract as a volume-only \
mention; OMIT both food_sentiment and service_sentiment.
  - Food and service sentiments are INDEPENDENT. "Great food but slow service" \
→ food=positive AND service=negative on the same extraction. Don't average.
  - "mixed" means the SAME aspect was both praised and criticized in the same \
comment (e.g. "the pasta is great but the meat dishes are dry"). Don't use \
mixed just because food and service differ.
  - If the comment is a generic positive/negative judgment ("love this place", \
"don't bother"), set food_sentiment to that judgment and OMIT service. If \
the comment specifically discusses food, set food only. If it specifically \
discusses both aspects, set both. ONLY omit food when the comment is purely \
about service/staff/atmosphere with no food or overall judgment.
  - Use the exact wording the commenter used for the mention — but the mention \
must be a RESTAURANT NAME (or unambiguous descriptor like "the Thai place on \
Colfax"). Do NOT extract:
      * Person names ("Carmen", "the owner") — those are people, not establishments.
      * Single-word abbreviations or filler ("Def", "FYI", "TBH", "IMO").
      * Generic categories ("the diner", "a sushi spot") with no identifying detail.
      * Job titles ("the chef", "the waitress").
      * Comma-separated combinations of mention + a person ("the owner, X").
  - If the comment is not about restaurants at all (politics, traffic, weather), \
record an empty list.

Always call the record_extractions tool, even with an empty list.
"""


TAG_VALUES = [
    "date_night",
    "hidden_gem",
    "hole_in_the_wall",
    "great_views",
    "cheap_eats",
    "special_occasion",
    "late_night",
    "outdoor_seating",
]


_RECORD_TOOL: dict = {
    "name": "record_extractions",
    "description": "Record the restaurant evaluations extracted from the comment.",
    "input_schema": {
        "type": "object",
        "properties": {
            "extractions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "mention": {
                            "type": "string",
                            "description": "Restaurant name as referenced in the comment (verbatim).",
                        },
                        "neighborhood_hint": {
                            "type": "string",
                            "description": "Neighborhood mentioned alongside, if any.",
                        },
                        "food_sentiment": {
                            "type": "string",
                            "enum": ["positive", "negative", "mixed"],
                            "description": "Sentiment about the food specifically.",
                        },
                        "service_sentiment": {
                            "type": "string",
                            "enum": ["positive", "negative", "mixed"],
                            "description": "Sentiment about service, staff, vibes, atmosphere, or wait times.",
                        },
                        "quote": {
                            "type": "string",
                            "description": "Verbatim snippet from the comment supporting the judgment. NEVER translated — keep the original language.",
                        },
                        "quote_translated": {
                            "type": "string",
                            "description": (
                                "English translation of `quote` when the source is "
                                "non-English. OMIT entirely when the source is already "
                                "English."
                            ),
                        },
                        "tags": {
                            "type": "array",
                            "description": (
                                "Vibe/occasion tags from the closed taxonomy. "
                                "Empty array if nothing applies. Don't invent tags."
                            ),
                            "items": {"type": "string", "enum": TAG_VALUES},
                        },
                    },
                    "required": ["mention", "quote"],
                },
            }
        },
        "required": ["extractions"],
    },
}


_client: Optional[anthropic.Anthropic] = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        # max_retries bumped from the SDK default of 2 → 8 to ride out the
        # 50k input-tokens-per-minute org cap on big batches. The SDK
        # respects Retry-After headers from 429s, so this is honest waiting
        # rather than fixed backoff.
        _client = anthropic.Anthropic(
            api_key=settings.anthropic_api_key,
            max_retries=8,
        )
    return _client


def extract_from_comment(
    comment_body: str,
    *,
    thread_title: Optional[str] = None,
    thread_body: Optional[str] = None,
    parent_chain: Optional[list] = None,
    model: str = DEFAULT_MODEL,
    max_tokens: int = 2048,
) -> list[Extraction]:
    """Extract restaurant evaluations from a single Reddit comment.

    Optional context unlocks attributing comments that don't name a
    restaurant themselves:
      - thread_title: e.g. "Has anyone been to Tavernetta?"
      - thread_body: the OP's post text beyond the title
      - parent_chain: list of {"author": str|None, "body": str}, closest
        parent first. Up to 3 ancestors typically.

    Returns an empty list if the comment isn't about restaurants or contains
    no evaluative mentions. Always issues exactly one Anthropic call.
    """
    parts: list = []
    if thread_title:
        parts.append(f"Thread title: {thread_title}")
    if thread_body and thread_body.strip():
        # Cap to control token spend. Most OP bodies are short; long ones
        # rarely add value past the first ~500 chars.
        body_excerpt = thread_body.strip()[:500]
        if len(thread_body) > 500:
            body_excerpt += "…"
        parts.append(f"Thread body: {body_excerpt}")
    if parent_chain:
        parts.append("Reply chain (closest parent first):")
        for p in parent_chain:
            author = p.get("author") or "unknown"
            pbody = (p.get("body") or "").strip()[:300]
            if not pbody:
                continue
            parts.append(f"  - u/{author}: {pbody}")
    parts.append(f"Comment to extract:\n{comment_body}")
    user_content = "\n\n".join(parts)

    client = _get_client()
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=_SYSTEM_PROMPT,
        tools=[_RECORD_TOOL],
        tool_choice={"type": "tool", "name": "record_extractions"},
        messages=[{"role": "user", "content": user_content}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "record_extractions":
            raw = block.input.get("extractions", []) or []
            # Tolerate occasional schema-violating outputs (e.g. missing
            # `quote`). Anthropic enforces tool input schemas server-side
            # but a small fraction still slip through, especially under
            # load. Skip them rather than crashing the whole batch.
            results: list[Extraction] = []
            for e in raw:
                try:
                    results.append(Extraction(**e))
                except Exception:
                    continue
            return results
    return []
