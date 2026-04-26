"""Central config. Loads .env.local from the repo root and exposes typed settings."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from pydantic import BaseModel


REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_ROOT / ".env.local"

# load_dotenv silently does nothing if the file is missing; that's fine for
# tests/CI where env may come from elsewhere. For local runs the file exists.
load_dotenv(ENV_PATH)


class Settings(BaseModel):
    anthropic_api_key: str
    google_maps_api_key: str
    supabase_url: str
    supabase_service_role_key: str

    # Reddit creds — optional until API approval lands. The pipeline can do
    # everything except the discover stage without them.
    reddit_client_id: Optional[str] = None
    reddit_client_secret: Optional[str] = None
    reddit_user_agent: Optional[str] = None

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            anthropic_api_key=_required("ANTHROPIC_API_KEY"),
            google_maps_api_key=_required("GOOGLE_MAPS_API_KEY"),
            supabase_url=_required("NEXT_PUBLIC_SUPABASE_URL"),
            supabase_service_role_key=_required("SUPABASE_SERVICE_ROLE_KEY"),
            reddit_client_id=os.environ.get("REDDIT_CLIENT_ID") or None,
            reddit_client_secret=os.environ.get("REDDIT_CLIENT_SECRET") or None,
            reddit_user_agent=os.environ.get("REDDIT_USER_AGENT") or None,
        )


def _required(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(
            f"Missing required env var {name!r}. Check {ENV_PATH}."
        )
    return val


settings = Settings.from_env()
