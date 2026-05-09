-- Track when a Reddit comment has been extract-processed, regardless of
-- whether the LLM produced any extraction rows for it.
--
-- Why: the previous idempotency gate (`comment_has_extractions`) returned
-- false for comments that were processed but produced an empty extraction
-- list — off-topic chatter, replies that don't name a restaurant, etc.
-- Every pipeline re-run paid the LLM cost to confirm those were still
-- empty. Same trap caught the neutral-mentions backfill: ~286 comments
-- per city were re-extracted at $$$ for zero data change.
--
-- Forward-looking fix: stamp `extracted_at` on every comment the extract
-- stage hands to the LLM. The new gate is `extracted_at IS NULL`, which
-- correctly skips both "produced extractions last time" and "produced an
-- empty list last time." Targeted re-extraction (e.g. after a prompt
-- change) clears `extracted_at` for the comments to reprocess.

alter table reddit_comments
  add column if not exists extracted_at timestamptz;

-- Conservative backfill: comments with at least one extraction were
-- definitely processed. Set extracted_at to the earliest extraction's
-- created_at as a proxy.
--
-- Comments with NO extractions remain NULL — we can't distinguish
-- "processed and produced empty" from "never processed" for the existing
-- corpus, so we accept paying the LLM cost once more on the next run to
-- populate extracted_at for them. After that, the gate is clean.
update reddit_comments c
set extracted_at = sub.first_extraction
from (
  select comment_id, min(created_at) as first_extraction
  from extractions
  group by comment_id
) sub
where c.id = sub.comment_id and c.extracted_at is null;

-- Partial index on NULL: most comments will eventually have extracted_at
-- set, so the "find unprocessed" query (the hot path during pipeline
-- runs) only needs to scan the small NULL slice.
create index if not exists reddit_comments_unextracted_idx
  on reddit_comments (id) where extracted_at is null;
