#!/usr/bin/env python3
"""Static checks for the yield matrix, decisions, and AI Race snapshot."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TENORS = ["1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "30Y"]
ORDER = ["US", "CA", "GB", "DE", "FR", "IT", "JP", "AU", "CN", "IN"]


def main() -> int:
    errors = []
    yields = json.loads((ROOT / "data" / "yields.json").read_text(encoding="utf-8"))
    banks = json.loads((ROOT / "data" / "central-banks.json").read_text(encoding="utf-8"))
    race = json.loads((ROOT / "data" / "ai-race.json").read_text(encoding="utf-8"))
    page = (ROOT / "index.html").read_text(encoding="utf-8")

    codes = [row["code"] for row in yields["countries"]]
    if codes != ORDER:
        errors.append(f"country order {codes}")
    for row in yields["countries"]:
        if list(row["yields"]) != TENORS:
            errors.append(f"{row['code']} tenor keys")
        for tenor, value in row["yields"].items():
            if value is not None and not isinstance(value, (int, float)):
                errors.append(f"{row['code']} {tenor} not numeric")
            if value is None and tenor not in row.get("gaps", {}):
                errors.append(f"{row['code']} {tenor} null without a gap reason")
        for tenor, reason in row.get("gaps", {}).items():
            if reason not in {"not_published", "not_in_feed"}:
                errors.append(f"{row['code']} {tenor} gap {reason}")
            if row["yields"].get(tenor) is not None:
                errors.append(f"{row['code']} {tenor} has both a value and a gap")

    actions = {bank["action"] for bank in banks["banks"]}
    if not actions <= {"raised", "cut", "held"}:
        errors.append(f"unexpected actions {actions}")
    if [bank["id"] for bank in banks["banks"]] != ["fed", "boc", "boe", "ecb", "boj", "rba", "pboc", "rbi"]:
        errors.append("central bank ids drifted")

    if len(race["models"]) < 10:
        errors.append("AI ranking is short")
    if len(race["labs"]) != 10:
        errors.append("expected 10 labs")
    ranks = [row["rank"] for row in race["models"]]
    if ranks != list(range(1, len(ranks) + 1)):
        errors.append("AI ranks are not contiguous")

    for needle in ('id="matrix"', "AI Race", "favicon.svg", "tab-airace", "market.js"):
        if needle not in page:
            errors.append(f"index.html missing {needle}")
    for icon in ("favicon.svg", "favicon.ico", "favicon-32x32.png", "favicon-16x16.png", "apple-touch-icon.png"):
        if not (ROOT / icon).exists():
            errors.append(f"missing {icon}")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"ok {len(codes)} markets, {len(banks['banks'])} banks, {len(race['models'])} models")
    return 0


if __name__ == "__main__":
    sys.exit(main())
