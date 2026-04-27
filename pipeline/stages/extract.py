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

For each distinct restaurant the comment evaluates, record:
  - mention: the restaurant name (verbatim from the comment, OR pulled from \
the thread title when the rules above apply). Don't canonicalize.
  - neighborhood_hint: a neighborhood name mentioned alongside the restaurant \
("Highlands", "RiNo", "Congress Park"). OMIT if not stated.
  - food_sentiment: positive | negative | mixed — about the food specifically. \
OMIT entirely if the comment doesn't discuss food.
  - service_sentiment: positive | negative | mixed — about service, staff, wait \
times, vibes, ambiance, or atmosphere. OMIT entirely if not discussed.
  - quote: the most relevant verbatim snippet from the comment that supports \
your judgment (one sentence ideally).

Strict rules:
  - Only extract EVALUATIONS (positive or negative judgments). Skip neutral \
mentions like "I went to X last week" or "X is on 16th street".
  - Food and service sentiments are INDEPENDENT. "Great food but slow service" \
→ food=positive AND service=negative on the same extraction. Don't average.
  - "mixed" means the SAME aspect was both praised and criticized in the same \
comment (e.g. "the pasta is great but the meat dishes are dry"). Don't use \
mixed just because food and service differ.
  - If the comment discusses ONLY food, OMIT service_sentiment. If it discusses \
ONLY service, OMIT food_sentiment. Never invent.
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
                            "description": "Verbatim snippet from the comment supporting the judgment.",
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
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
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
