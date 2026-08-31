"""The single month-stepping loop.

Snowball, avalanche, and the minimums-only baseline are all this function with
different seams. Keeping the arithmetic in one place is a correctness property,
not a style preference: three copies would be three independent homes for a
rounding bug, and a near-certainty that a fix lands in only two of them.
"""

from collections.abc import Callable, Mapping, Sequence
from decimal import Decimal

from .interest import monthly_interest
from .models import Debt, DebtMonth, Month, Outcome, Schedule, validate_portfolio
from .money import to_cents

MAX_MONTHS = 1200
ZERO = Decimal("0.00")

OrderFn = Callable[[Sequence[Debt], Mapping[str, Decimal]], tuple[Debt, ...]]
MinimumRule = Callable[[Debt, Decimal], Decimal]


def _build_month(
    index: int,
    active: Sequence[Debt],
    starting: Mapping[str, Decimal],
    interest: Mapping[str, Decimal],
    payments: Mapping[str, Decimal],
    balances: Mapping[str, Decimal],
) -> Month:
    rows = tuple(
        DebtMonth(
            debt_id=d.id,
            starting_balance=starting[d.id],
            interest_charged=interest[d.id],
            payment_applied=payments[d.id],
            ending_balance=balances[d.id],
        )
        for d in active
    )
    return Month(
        index=index,
        debts=rows,
        total_payment=sum((r.payment_applied for r in rows), ZERO),
        total_interest=sum((r.interest_charged for r in rows), ZERO),
        remaining_balance=sum(balances.values(), ZERO),
    )


def simulate(
    debts: Sequence[Debt],
    extra_payment: Decimal,
    order_fn: OrderFn,
    minimum_rule: MinimumRule,
    rollover: bool = True,
) -> Schedule:
    """Step month by month until every debt clears."""
    validate_portfolio(debts, extra_payment)
    extra_payment = to_cents(extra_payment)

    active_debts = [d for d in debts if d.balance > ZERO]
    if not active_debts:
        return Schedule(months=(), outcome=Outcome.PAID_OFF)

    balances: dict[str, Decimal] = {d.id: d.balance for d in active_debts}
    months: list[Month] = []
    freed_pool = ZERO
    previous_total = sum(balances.values(), ZERO)

    for index in range(1, MAX_MONTHS + 1):
        active = [d for d in active_debts if balances[d.id] > ZERO]

        starting = {d.id: balances[d.id] for d in active}

        interest: dict[str, Decimal] = {}
        for d in active:
            charge = monthly_interest(balances[d.id], d.apr)
            interest[d.id] = charge
            balances[d.id] += charge

        scheduled = {d.id: minimum_rule(d, starting[d.id]) for d in active}
        required = {d.id: min(scheduled[d.id], balances[d.id]) for d in active}

        # Budget is built from SCHEDULED minimums, not required ones. The gap
        # between them is the final-payment truncation remainder, and routing
        # it through `surplus` is what keeps it from silently evaporating.
        budget = sum(scheduled.values(), ZERO) + extra_payment + freed_pool

        payments: dict[str, Decimal] = {}
        for d in active:
            payments[d.id] = required[d.id]
            balances[d.id] -= required[d.id]

        surplus = budget - sum(required.values(), ZERO)
        if surplus > ZERO:
            for d in order_fn(active, starting):
                if surplus <= ZERO:
                    break
                pay = min(surplus, balances[d.id])
                if pay <= ZERO:
                    continue
                balances[d.id] -= pay
                payments[d.id] += pay
                surplus -= pay

        if rollover:
            for d in active:
                if balances[d.id] <= ZERO:
                    freed_pool += scheduled[d.id]

        months.append(_build_month(index, active, starting, interest, payments, balances))

        total_remaining = sum(balances.values(), ZERO)
        if total_remaining <= ZERO:
            break
        if total_remaining >= previous_total and all(
            interest[d.id] > scheduled[d.id] + extra_payment + freed_pool
            for d in active
        ):
            # Sound early exit: every active debt's interest exceeds its
            # scheduled minimum plus ALL distributable surplus, so even aiming
            # the entire surplus at any single debt would leave it growing.
            # Every balance is then non-decreasing under any allocation, no
            # debt can ever clear, the freed pool never grows, and each month
            # is strictly worse — a real induction. A mere total-balance stall
            # is NOT proof: in a mixed-APR portfolio a high-APR debt can pay
            # down while a low-APR one grows, and once the first debt clears
            # its freed minimum can rescue the rest. When the condition fails
            # we keep simulating; MAX_MONTHS is the unconditional backstop.
            return Schedule(
                months=tuple(months),
                outcome=Outcome.NEVER_PAYS_OFF,
                underwater_debt_ids=tuple(sorted(d.id for d in active)),
            )
        previous_total = total_remaining
    else:
        # MAX_MONTHS exhausted without clearing. Underwater means interest
        # outran the payment in the final simulated month — a glacial but
        # healthy debt (payment beats interest, horizon merely past the cap)
        # is not underwater, and the tuple may be empty.
        underwater = tuple(
            sorted(
                row.debt_id
                for row in months[-1].debts
                if row.interest_charged > row.payment_applied
            )
        )
        return Schedule(
            months=tuple(months),
            outcome=Outcome.NEVER_PAYS_OFF,
            underwater_debt_ids=underwater,
        )

    return Schedule(months=tuple(months), outcome=Outcome.PAID_OFF)
