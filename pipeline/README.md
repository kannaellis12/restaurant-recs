# Pipeline

Python pipeline that turns Reddit threads into ranked restaurant scores.

## Stages

1. **`discover`** — pull threads from the seed subreddits in `config/subreddits.ts` plus
   auto-discovered ones via Reddit search. Keyword-filter for general subs.
2. **`relevance_gate`** — cheap LLM (Claude Haiku) judges each thread's relevance.
   Drop below threshold (default 0.4).
3. **`extract`** — better LLM (Claude Sonnet/Opus) pulls per-comment data:
   `{ user, restaurant_mention, neighborhood_hint, food_sentiment, service_sentiment, quote }`
4. **`resolve`** — web-research agent → Google Places ID + confidence score.
   Low confidence routes to the admin queue.
5. **`score`** — aggregate per restaurant: `0.75 * positive_rate + 0.25 * pos/neg_ratio`,
   separately for food and service. Compute city ranks.

## Setup (deferred — fill in when ready to run)

```bash
cd pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Env vars (read from `../.env.local` at the repo root):
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`
- `ANTHROPIC_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
