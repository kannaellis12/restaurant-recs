"""Pydantic models the pipeline passes around between stages."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# Resolution method values; mirrors the schema's `place_resolutions.method` /
# `extractions.resolution_method` columns.
ResolutionMethod = Literal[
    "search",     # Plain Google Places Text Search produced a single confident match
    "agent",      # An LLM-driven research agent disambiguated
    "manual",     # A human in /admin chose the match
    "fallback",   # Best-guess attached with a disclaimer (low confidence)
    "no_match",   # No reasonable match — flag for admin queue
]

# Aspect sentiment values; mirrors the schema's check constraint.
AspectSentiment = Literal["positive", "negative", "mixed"]


class Extraction(BaseModel):
    """One restaurant evaluation extracted from a Reddit comment.

    A single comment can yield multiple Extractions if it discusses multiple
    restaurants. food_sentiment and service_sentiment are independently
    nullable — a comment may discuss only one aspect (or neither, in which
    case the extraction is dropped before this point).

    `tags` are vibe/occasion descriptors drawn from a closed taxonomy
    enforced in the extract prompt. Empty list when nothing applies.
    """

    mention: str
    neighborhood_hint: Optional[str] = None
    food_sentiment: Optional[AspectSentiment] = None
    service_sentiment: Optional[AspectSentiment] = None
    quote: str
    # English translation of `quote` when the source is non-English. None
    # for English quotes. The frontend renders this as the primary quote
    # and falls back to `quote` (the original) below it when set.
    quote_translated: Optional[str] = None
    tags: list[str] = Field(default_factory=list)


class PlaceCandidate(BaseModel):
    """A single Google Places search result we're considering."""

    place_id: str
    name: str
    address: Optional[str] = None
    lat: float
    lng: float
    price_level: Optional[int] = Field(None, ge=1, le=4)
    website: Optional[str] = None
    types: list[str] = Field(default_factory=list)
    google_rating: Optional[float] = None
    google_review_ct: Optional[int] = None
    # OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY | None
    business_status: Optional[str] = None
    # Derived from addressComponents — used as a fallback when no Reddit
    # comment mentioned a neighborhood for this restaurant.
    derived_neighborhood: Optional[str] = None


class ResolveResult(BaseModel):
    """Output of the resolve stage for a single mention."""

    # Inputs (echoed back so callers can pair results with their queries)
    mention: str
    city_slug: str
    neighborhood_hint: Optional[str] = None

    # Outcome
    method: ResolutionMethod
    confidence: float = Field(..., ge=0, le=1)

    # The chosen candidate. None when method is 'no_match'.
    candidate: Optional[PlaceCandidate] = None

    # Other candidates considered (top-N). Useful for the admin queue when
    # the result is ambiguous.
    alternatives: list[PlaceCandidate] = Field(default_factory=list)

    # Human-readable explanation of why this confidence / method was chosen.
    reasoning: str = ""

    @property
    def needs_review(self) -> bool:
        """True if this result should land in the admin reconciliation queue."""
        return self.confidence < 0.6 or self.method in ("no_match", "fallback")
