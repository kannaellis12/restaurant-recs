"""Dedicated translation pass for `extractions.quote_translated`.

Why this exists separately from the extract LLM call:

The extract pass already does a lot — find restaurant mentions, score
sentiment per aspect, tag with vibes, and emit a supporting quote. We tried
piggybacking translation on the same call, and the model is unreliable about
it: only ~15% of obvious French quotes got translated, and some of the ones
that did had translations drifting toward paraphrase of the broader comment
rather than the literal quote (because the LLM has the whole comment in
context).

This script asks Claude Haiku one focused question per quote: "translate
this string". The LLM cannot pull from broader context because it doesn't
have any. It either returns a literal English translation or returns the
sentinel `[SKIP]` when the input is already in English.

Usage (from the repo root, with the venv active):

  python -m pipeline.scripts.translate_quotes --city paris
  python -m pipeline.scripts.translate_quotes --all

Idempotent: rows with a non-null `quote_translated` are skipped by default.
Pass `--force` to re-translate every row (useful when the prompt changes
or you want to overwrite suspect existing translations).
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass

import anthropic
from rich.console import Console

from pipeline import db
from pipeline.cities import CITIES
from pipeline.config import settings


DEFAULT_MODEL = "claude-haiku-4-5-20251001"

_TRANSLATION_SYSTEM = """\
You are a translator for restaurant review snippets. Translate the user's \
input into idiomatic English.

Strict rules:
1. Translate ONLY the words in the input. Do not paraphrase, summarize, or \
add commentary. Stay tightly literal.
2. Preserve proper nouns (restaurant names, neighborhoods, dish names) \
verbatim — don't anglicize them.
3. Preserve tone (slangy stays slangy, formal stays formal, profane stays \
profane).
4. Output ONLY the translated text, no quotation marks, no preamble, no \
explanatory notes.
5. If the input is already 100% English, output the literal sentinel \
[SKIP] and nothing else. Even mostly-English with one French word still \
needs translation — only output [SKIP] when nothing needs translating.
"""

SKIP_SENTINEL = "[SKIP]"


@dataclass
class TranslateRow:
    id: str
    quote: str


def _fetch_untranslated(city_slug: str, force: bool) -> list[TranslateRow]:
    """Pull extractions for a city that need translation.

    Paginates because Supabase's default `.select()` row cap is 1000 and
    Paris has ~1485 extractions — without pagination the script silently
    only processes the first page. We use `.range(start, end)` to walk
    the full set and stop when a page comes back short.
    """
    client = db.get_client()
    out: list[TranslateRow] = []
    PAGE = 1000
    offset = 0
    while True:
        q = (
            client.table("extractions")
            .select(
                "id, quote_original, quote_translated, "
                "comment:reddit_comments!inner("
                "  thread:reddit_threads!inner(city_slug)"
                ")"
            )
            .eq("comment.thread.city_slug", city_slug)
            .range(offset, offset + PAGE - 1)
        )
        if not force:
            q = q.is_("quote_translated", "null")
        rows = q.execute().data or []
        for r in rows:
            quote = (r.get("quote_original") or "").strip()
            if quote:
                out.append(TranslateRow(id=r["id"], quote=quote))
        if len(rows) < PAGE:
            break
        offset += PAGE
    return out


_client: anthropic.Anthropic | None = None


def _llm() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(
            api_key=settings.anthropic_api_key,
            max_retries=8,
        )
    return _client


def _translate_one(quote: str, *, model: str = DEFAULT_MODEL) -> str | None:
    """Returns the English translation, or None when the quote is already
    English (the LLM returned the [SKIP] sentinel) or the call yielded no
    usable text. Caller should write None as a NULL `quote_translated`.
    """
    response = _llm().messages.create(
        model=model,
        max_tokens=1024,
        system=_TRANSLATION_SYSTEM,
        messages=[{"role": "user", "content": quote}],
    )
    parts: list[str] = []
    for block in response.content:
        if block.type == "text":
            parts.append(block.text)
    text = "".join(parts).strip()
    if not text:
        return None
    if text == SKIP_SENTINEL or text.startswith(SKIP_SENTINEL):
        return None
    return text


def _set_translation(extraction_id: str, translation: str | None) -> None:
    """Write the translation column. We always write — including writing
    NULL when the LLM said [SKIP] — so re-running with --force converges
    on the right state for English-source rows too.
    """
    db.get_client().table("extractions").update(
        {"quote_translated": translation}
    ).eq("id", extraction_id).execute()


def translate_city(
    city_slug: str,
    *,
    force: bool,
    console: Console,
) -> dict:
    rows = _fetch_untranslated(city_slug, force=force)
    if not rows:
        console.print(f"  [dim]{city_slug}: nothing to translate[/dim]")
        return {"checked": 0, "translated": 0, "skipped": 0, "errors": 0}

    console.print(f"  [cyan]{city_slug}[/cyan]: {len(rows)} quote(s) to process")

    translated = 0
    skipped = 0
    errors = 0

    for i, row in enumerate(rows, start=1):
        try:
            t = _translate_one(row.quote)
        except Exception as e:
            errors += 1
            console.print(f"    [red]✗[/red] row {row.id}: {type(e).__name__}: {e}")
            continue
        _set_translation(row.id, t)
        if t is None:
            skipped += 1
        else:
            translated += 1
        if i % 50 == 0:
            console.print(
                f"    progress: {i}/{len(rows)}   "
                f"translated={translated} skipped={skipped} errors={errors}"
            )

    console.print(
        f"    [green]done[/green]: translated={translated} "
        f"skipped(English)={skipped} errors={errors}"
    )
    return {
        "checked": len(rows),
        "translated": translated,
        "skipped": skipped,
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Translate non-English `extractions.quote_original` into `quote_translated`."
    )
    parser.add_argument(
        "--city",
        action="append",
        default=[],
        help="City slug. Repeatable. Mutually exclusive with --all.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run for every configured city.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-translate rows even when `quote_translated` is already set. "
        "Use this when the prompt changes or to overwrite suspect translations.",
    )
    args = parser.parse_args()

    if args.all and args.city:
        print("Use --all OR --city, not both.", file=sys.stderr)
        return 1
    cities = list(CITIES.keys()) if args.all else args.city
    if not cities:
        print("Provide --city <slug> (repeatable) or --all.", file=sys.stderr)
        return 1
    for c in cities:
        if c not in CITIES:
            print(f"Unknown city: {c!r}. Known: {list(CITIES)}", file=sys.stderr)
            return 1

    console = Console()
    title = "Translate quotes (force re-translation)" if args.force else "Translate quotes"
    console.rule(f"[bold]{title}[/bold]")

    totals = {"checked": 0, "translated": 0, "skipped": 0, "errors": 0}
    for c in cities:
        report = translate_city(c, force=args.force, console=console)
        for k, v in report.items():
            totals[k] += v

    console.rule("[bold]Done[/bold]")
    console.print(
        f"  Checked {totals['checked']} quote(s).  "
        f"Translated [green]{totals['translated']}[/green].  "
        f"Skipped (already English) {totals['skipped']}.  "
        f"Errors [red]{totals['errors']}[/red]."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
