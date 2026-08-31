"""Calendar month arithmetic for the API boundary.

The engine speaks only in 1-based month indices, which keeps it a pure
function with no hidden clock. Turning those indices into calendar months is
this module's entire job.

Because the engine has no concept of days, this is pure integer arithmetic —
no leap years, no "January 31st plus one month", no daylight saving, no
timezones. Working in an absolute month count also removes the year rollover
as a special case, which is where date arithmetic usually breaks.
"""

import re

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"

_MONTH_RE = re.compile(MONTH_PATTERN)
_MONTHS_PER_YEAR = 12


def parse_month(value: str) -> tuple[int, int]:
    """Parse "2026-09" into (2026, 9). Raises ValueError on anything else."""
    if not _MONTH_RE.match(value):
        raise ValueError(f"expected a YYYY-MM month, got {value!r}")
    year, month = value.split("-")
    return int(year), int(month)


def shift_month(year: int, month: int, offset: int) -> tuple[int, int]:
    """Move (year, month) by `offset` months, forward or back."""
    total = year * _MONTHS_PER_YEAR + (month - 1) + offset
    return total // _MONTHS_PER_YEAR, total % _MONTHS_PER_YEAR + 1


def month_label(start_month: str, index: int) -> str:
    """Calendar label for the 1-based month `index`.

    Month 1 IS ``start_month`` — the first month a payment is made — so the
    offset is ``index - 1``. Callers must not pass an index below 1: a
    zero-month or never-paying-off scenario has no payoff month, and the
    mapper emits null for those rather than asking this function to invent one.
    """
    year, month = shift_month(*parse_month(start_month), index - 1)
    return f"{year:04d}-{month:02d}"
