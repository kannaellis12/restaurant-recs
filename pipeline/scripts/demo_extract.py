"""Demo: run the extract stage against hand-crafted Denver-style comments.

Usage (from the repo root, with the venv active):
    python -m pipeline.scripts.demo_extract

Hits the Anthropic API once per comment. ~9 calls, takes ~15-30s total.
"""
from __future__ import annotations

from typing import Optional

from rich.console import Console
from rich.panel import Panel
from rich.text import Text

from pipeline.stages.extract import extract_from_comment


# Hand-crafted to exercise the cases we care about: pure food, pure service,
# both, mixed within an aspect, multi-restaurant, neighborhood hints, and a
# negative control (off-topic comment).
SAMPLE_COMMENTS: list[tuple[str, str]] = [
    (
        "Pure food positive",
        "Sushi Den is the best sushi in Denver, hands down. The omakase is incredible and worth every penny.",
    ),
    (
        "Pure food negative",
        "Snooze used to be good but it's gone way downhill. The pancakes are gummy and the coffee is weak.",
    ),
    (
        "Food + service positive",
        "Sap Sua in Congress Park is amazing — the menu is creative and the staff is super friendly.",
    ),
    (
        "Food positive, service negative",
        "Hop Alley's Peking duck is incredible but the wait for a table is brutal even with reservations.",
    ),
    (
        "Multi-restaurant",
        "If you want good Mexican in Denver, Tacos Tequila Whiskey on York is solid. Mister Oso in RiNo is fancier but also great.",
    ),
    (
        "Mixed within an aspect",
        "Tavernetta has hit-or-miss food. The pasta is great, the meat dishes are dry. Service is consistently good though.",
    ),
    (
        "Neighborhood hint",
        "There's a great Vietnamese spot called Sap Sua in Congress Park.",
    ),
    (
        "Negative both",
        "Sam's No. 3 is overrated. Diner food is mediocre and the staff is rude.",
    ),
    (
        "Off-topic (negative control)",
        "I-25 traffic at rush hour is the worst thing about this city.",
    ),
]


def main() -> None:
    console = Console()

    for label, comment in SAMPLE_COMMENTS:
        console.print(
            Panel(
                comment,
                title=f"[bold cyan]{label}[/bold cyan]",
                border_style="cyan",
                title_align="left",
            )
        )
        extractions = extract_from_comment(comment)
        if not extractions:
            console.print("  [dim italic]No extractions.[/dim italic]\n")
            continue
        for e in extractions:
            line = Text("  • ", style="bold")
            line.append(e.mention, style="bold yellow")
            if e.neighborhood_hint:
                line.append(f"  ({e.neighborhood_hint})", style="dim")
            line.append("\n      food=", style="dim")
            line.append(_aspect_text(e.food_sentiment))
            line.append("   service=", style="dim")
            line.append(_aspect_text(e.service_sentiment))
            line.append("\n      ", style="dim")
            line.append(f"“{e.quote}”", style="italic dim")
            console.print(line)
        console.print("")


def _aspect_text(sentiment: Optional[str]) -> Text:
    if sentiment is None:
        return Text("—", style="dim")
    color = {"positive": "green", "negative": "red", "mixed": "yellow"}[sentiment]
    return Text(sentiment, style=f"bold {color}")


if __name__ == "__main__":
    main()
