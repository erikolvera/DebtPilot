from decimal import Decimal

from app.engine.models import Debt
from app.engine.ordering import avalanche_order, snowball_order


def debt(id_, balance, apr, minimum="25.00") -> Debt:
    return Debt(
        id=id_,
        name=f"Card {id_}",
        balance=Decimal(balance),
        apr=Decimal(apr),
        minimum_payment=Decimal(minimum),
    )


def balances_of(debts) -> dict[str, Decimal]:
    return {d.id: d.balance for d in debts}


def ids(ordered) -> list[str]:
    return [d.id for d in ordered]


def test_snowball_orders_by_smallest_balance():
    debts = [debt("a", "3000.00", "10.00"), debt("b", "500.00", "20.00"),
             debt("c", "1500.00", "15.00")]
    assert ids(snowball_order(debts, balances_of(debts))) == ["b", "c", "a"]


def test_avalanche_orders_by_highest_apr():
    debts = [debt("a", "3000.00", "10.00"), debt("b", "500.00", "20.00"),
             debt("c", "1500.00", "15.00")]
    assert ids(avalanche_order(debts, balances_of(debts))) == ["b", "c", "a"]


def test_snowball_uses_the_passed_balances_not_the_original():
    debts = [debt("a", "3000.00", "10.00"), debt("b", "500.00", "20.00")]
    current = {"a": Decimal("100.00"), "b": Decimal("500.00")}
    assert ids(snowball_order(debts, current)) == ["a", "b"]


def test_avalanche_breaks_apr_ties_by_smaller_balance():
    debts = [debt("a", "3000.00", "20.00"), debt("b", "500.00", "20.00")]
    assert ids(avalanche_order(debts, balances_of(debts))) == ["b", "a"]


def test_snowball_breaks_balance_ties_by_higher_apr():
    debts = [debt("a", "1000.00", "10.00"), debt("b", "1000.00", "25.00")]
    assert ids(snowball_order(debts, balances_of(debts))) == ["b", "a"]


def test_full_ties_break_by_id():
    debts = [debt("z", "1000.00", "20.00"), debt("a", "1000.00", "20.00")]
    assert ids(snowball_order(debts, balances_of(debts))) == ["a", "z"]
    assert ids(avalanche_order(debts, balances_of(debts))) == ["a", "z"]


def test_empty_input_returns_empty_tuple():
    assert snowball_order([], {}) == ()
    assert avalanche_order([], {}) == ()
