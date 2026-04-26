"""Demo: run the resolve stage against hand-coded Denver mentions.

Usage (from the repo root, with the venv active):
    python -m pipeline.scripts.demo_resolve

Prints a table of resolved Place IDs, confidence scores, and reasoning. Does
NOT write to the DB — this is purely for verifying the resolver's behavior
before we commit to persistence.
"""
from __future__ import annotations

from typing import Optional

from rich.console import Console
from rich.table import Table

from pipeline.stages.resolve import resolve_mention


# Hand-picked Denver mentions chosen to exercise the easy + tricky cases.
DEMO_MENTIONS: list[tuple[str, Optional[str]]] = [
    ("Sushi Den", None),
    ("Sap Sua", "Congress Park"),
    ("Tacos Tequila Whiskey", None),
    ("Hop Alley", "RiNo"),
    ("Pizzeria Locale", "Highlands"),
    ("Sam's No. 3", None),
    ("Snooze", None),
    ("Tavernetta", "LoDo"),
    # Trickier cases:
    ("Joe's Pizza", None),                 # Common name — likely ambiguous
    ("the Thai place on Colfax", None),    # Vague — should fall through to low confidence
]


def main() -> None:
    console = Console()
    table = Table(title="Resolve Stage Demo — Denver", show_lines=True)
    table.add_column("Mention", style="cyan", no_wrap=True)
    table.add_column("Hint")
    table.add_column("Conf", justify="right")
    table.add_column("Match", style="green")
    table.add_column("Address", style="dim")
    table.add_column("Method")
    table.add_column("Reasoning", style="dim", overflow="fold")

    flagged: list[str] = []

    for mention, hint in DEMO_MENTIONS:
        result = resolve_mention(mention, "denver", hint)
        match = result.candidate.name if result.candidate else "—"
        addr = result.candidate.address if result.candidate else "—"
        conf_str = f"[bold]{result.confidence:.2f}[/bold]"
        if result.confidence < 0.6:
            conf_str = f"[red]{result.confidence:.2f}[/red]"
            flagged.append(mention)
        elif result.confidence < 0.8:
            conf_str = f"[yellow]{result.confidence:.2f}[/yellow]"
        else:
            conf_str = f"[green]{result.confidence:.2f}[/green]"
        table.add_row(
            mention,
            hint or "",
            conf_str,
            match,
            addr or "",
            result.method,
            result.reasoning,
        )

    console.print(table)
    if flagged:
        console.print(
            f"\n[red]{len(flagged)} mention(s) below 0.60 confidence — would route to admin queue:[/red] "
            f"{', '.join(repr(m) for m in flagged)}"
        )
    else:
        console.print("\n[green]All mentions resolved at >= 0.60 confidence.[/green]")


if __name__ == "__main__":
    main()
