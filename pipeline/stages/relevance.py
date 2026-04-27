"""Relevance gate — judge whether a Reddit thread is about restaurant recs.

Cheap LLM filter (Haiku 4.5). Each thread that hasn't been scored yet gets a
0..1 relevance score written to reddit_threads.relevance. Downstream stages
(extract) only process threads above a threshold.

Saves real money once we expand to large general subs (r/travel, r/food)
where most threads have nothing to do with our target cities.
"""
from __future__ import annotations

from typing import Optional

import anthropic

from pipeline.config import settings


DEFAULT_MODEL = "claude-haiku-4-5-20251001"


_SYSTEM_PROMPT = """\
You score Reddit threads on a 0..1 scale for relevance to RESTAURANT \
RECOMMENDATIONS in a specific city. Anchor points:

  1.0  Clearly asking for or giving specific restaurant recommendations \
("Best ramen in Denver?", "Tried Sushi Den last night and...").
  0.7  About local food/dining culture but doesn't name specific places \
("How's the dining scene in NOLA?", "Why are restaurants closing here?").
  0.4  Tangentially mentions food but isn't about restaurants \
("My grocery store haul"; "I cooked X last night").
  0.1  Vaguely mentions food in passing, not the topic of the thread.
  0.0  Not about food at all (politics, traffic, music, complaints, news).

Output ONLY the number via the record_relevance tool — no commentary.
"""


_TOOL: dict = {
    "name": "record_relevance",
    "description": "Record the thread's relevance score.",
    "input_schema": {
        "type": "object",
        "properties": {
            "score": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Relevance to restaurant recommendations, 0..1.",
            }
        },
        "required": ["score"],
    },
}


_client: Optional[anthropic.Anthropic] = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _client


def score_thread_relevance(
    *,
    title: str,
    body: str = "",
    city_name: str,
    model: str = DEFAULT_MODEL,
) -> float:
    """Return a 0..1 relevance score for a single thread."""
    user = f"City: {city_name}\nTitle: {title}\nBody: {(body or '').strip()[:1500]}"
    client = _get_client()
    response = client.messages.create(
        model=model,
        max_tokens=128,
        system=_SYSTEM_PROMPT,
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": "record_relevance"},
        messages=[{"role": "user", "content": user}],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == "record_relevance":
            score = block.input.get("score")
            if isinstance(score, (int, float)):
                return float(max(0.0, min(1.0, score)))
    return 0.0
