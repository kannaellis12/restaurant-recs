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

For each distinct restaurant the comment evaluates, record:
  - mention: the restaurant name verbatim from the comment (e.g. "Sushi Den", \
"the new Vietnamese spot on Colfax"). Don't canonicalize — that's a downstream step.
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
  - Use the exact wording the commenter used for the mention.
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
    model: str = DEFAULT_MODEL,
    max_tokens: int = 2048,
) -> list[Extraction]:
    """Extract restaurant evaluations from a single Reddit comment.

    Returns an empty list if the comment isn't about restaurants or contains
    no evaluative mentions. Always issues exactly one Anthropic call per call.
    """
    client = _get_client()
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=_SYSTEM_PROMPT,
        tools=[_RECORD_TOOL],
        tool_choice={"type": "tool", "name": "record_extractions"},
        messages=[{"role": "user", "content": comment_body}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "record_extractions":
            raw = block.input.get("extractions", []) or []
            return [Extraction(**e) for e in raw]
    return []
