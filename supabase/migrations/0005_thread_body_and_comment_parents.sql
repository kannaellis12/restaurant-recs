-- Add context fields the extract stage uses to attribute "agreed!"-style
-- replies that don't name a restaurant directly. Apply after 0004.
--
-- Background: the original schema only stored the thread title and the
-- comment body in isolation. Reddit threads commonly look like:
--
--   Title:      "Has anyone been to Tavernetta?"
--   OP body:    "Looking for date night options around LoDo..."
--   Comment A:  "Tavernetta is incredible — pasta is the best in town"
--   Comment B (reply to A):  "Agreed! And the bread service is amazing"
--
-- With only title + comment body, the extract LLM can attribute Comment A
-- to Tavernetta (title match) but Comment B falls through (no restaurant
-- named, generic context). After this migration we capture:
--
--   reddit_threads.body          — the OP's post text beyond the title
--   reddit_comments.parent_comment_id — Reddit fullname ('t1_xxx') of the
--                                       comment this one is replying to,
--                                       or NULL for top-level comments
--
-- Both nullable so existing rows are unaffected. Subsequent discover runs
-- populate them; in-memory parent-chain walking lets extract pass replies'
-- ancestor context to the LLM.

alter table reddit_threads
  add column if not exists body text;

alter table reddit_comments
  add column if not exists parent_comment_id text;

-- Speeds up the parent-chain walk: we look up parents by their reddit_id
-- (which is the parent_comment_id value of the child).
create index if not exists reddit_comments_parent_idx
  on reddit_comments (parent_comment_id);
