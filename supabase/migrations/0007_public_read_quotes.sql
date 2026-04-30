-- Allow the anon key (frontend) to read the tables that back the
-- restaurant detail page's "What people are saying" section.
--
-- These tables hold derived data from PUBLIC Reddit content — thread
-- titles, comment bodies, and our LLM-extracted aspect sentiments —
-- so granting public read access doesn't expose anything sensitive.
--
-- Admin-only tables (`place_resolutions`, `flags`) intentionally remain
-- locked down: those carry internal resolution audit trails and the
-- reconciliation queue, neither of which belongs on the public site.

create policy "public read reddit_threads"
  on reddit_threads     for select to anon, authenticated using (true);

create policy "public read reddit_comments"
  on reddit_comments    for select to anon, authenticated using (true);

create policy "public read extractions"
  on extractions        for select to anon, authenticated using (true);
