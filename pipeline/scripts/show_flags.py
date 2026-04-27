"""Print all open flags from the reconciliation queue with context.

Usage:
    python -m pipeline.scripts.show_flags

This is a tide-me-over until the proper /admin page exists. It joins the flag
to its extraction (mention, sentiments, quote), the underlying restaurant
candidate (if any), and the source comment (subreddit, body) so you can
quickly judge whether to accept, fix, or dismiss each flag.
"""
from __future__ import annotations

from rich.console import Console
from rich.panel import Panel

from pipeline import db


def main() -> None:
    console = Console()
    client = db.get_client()

    flags = (
        client.table("flags")
        .select("id, kind, details, extraction_id, restaurant_id, status, created_at")
        .eq("status", "open")
        .order("created_at", desc=False)
        .execute()
        .data
        or []
    )

    if not flags:
        console.print("[green]No open flags.[/green]")
        return

    console.print(f"[bold]{len(flags)} open flag(s):[/bold]\n")

    for i, f in enumerate(flags, 1):
        d = f.get("details") or {}

        # Pull the extraction this flag references
        ext = None
        if f.get("extraction_id"):
            r = (
                client.table("extractions")
                .select(
                    "mention_text, neighborhood_hint, food_sentiment, "
                    "service_sentiment, quote_original, vote_weight, "
                    "resolution_confidence, resolution_method, comment_id"
                )
                .eq("id", f["extraction_id"])
                .limit(1)
                .execute()
                .data
            )
            ext = r[0] if r else None

        # Pull the candidate restaurant (the resolver's best guess)
        rest = None
        if f.get("restaurant_id"):
            r = (
                client.table("restaurants")
                .select("name, address, website, place_id")
                .eq("id", f["restaurant_id"])
                .limit(1)
                .execute()
                .data
            )
            rest = r[0] if r else None

        # Pull the source comment + thread
        comment = None
        thread = None
        if ext and ext.get("comment_id"):
            r = (
                client.table("reddit_comments")
                .select("body, author, thread_id")
                .eq("id", ext["comment_id"])
                .limit(1)
                .execute()
                .data
            )
            comment = r[0] if r else None
            if comment and comment.get("thread_id"):
                r2 = (
                    client.table("reddit_threads")
                    .select("subreddit, title, url")
                    .eq("id", comment["thread_id"])
                    .limit(1)
                    .execute()
                    .data
                )
                thread = r2[0] if r2 else None

        # Render
        title = f"[{i}] {f['kind']}"
        body_lines = []
        body_lines.append(f"[bold cyan]Mention:[/bold cyan] {d.get('mention') or (ext or {}).get('mention_text') or '?'}")
        if ext:
            food = ext.get("food_sentiment") or "—"
            service = ext.get("service_sentiment") or "—"
            body_lines.append(
                f"[dim]Sentiments:[/dim] food={food}  service={service}  "
                f"vote_weight={ext.get('vote_weight')}"
            )
            body_lines.append(f"[dim]Quote:[/dim] [italic]{(ext.get('quote_original') or '')[:300]}[/italic]")
        if rest:
            body_lines.append(
                f"[bold yellow]Resolver guessed:[/bold yellow] {rest.get('name')} "
                f"([dim]{rest.get('address') or ''}[/dim])"
            )
            body_lines.append(f"[dim]Place ID:[/dim] {rest.get('place_id')}")
            if rest.get("website"):
                body_lines.append(f"[dim]Website:[/dim] {rest.get('website')}")
        else:
            body_lines.append("[bold yellow]Resolver guessed:[/bold yellow] [red]no candidate[/red]")
        body_lines.append(
            f"[dim]Confidence:[/dim] {d.get('confidence') or (ext or {}).get('resolution_confidence', '?')}  "
            f"[dim]Method:[/dim] {d.get('method') or (ext or {}).get('resolution_method', '?')}"
        )
        body_lines.append(f"[dim]Reasoning:[/dim] {d.get('reasoning', '?')}")
        if thread:
            body_lines.append(
                f"[dim]Source:[/dim] r/{thread.get('subreddit')} — "
                f"\"{(thread.get('title') or '')[:80]}\""
            )
            if thread.get("url"):
                body_lines.append(f"[dim]Thread:[/dim] {thread['url']}")
        if comment:
            body_lines.append(
                f"[dim]Comment by u/{comment.get('author', '?')}:[/dim] "
                f"[italic]{(comment.get('body') or '')[:200]}[/italic]"
            )

        console.print(Panel("\n".join(body_lines), title=title, border_style="yellow"))


if __name__ == "__main__":
    main()
