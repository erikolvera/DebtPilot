"""Every query against `public.debts`, in one auditable place.

Each function takes `user_id` as a required argument and writes
`where user_id = :user_id` into its SQL. That is the belt; the row-level
security policies are the braces. One module means one file to audit, and a
filter missing here returns zero rows rather than everyone's.
"""

from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.engine import Connection, Row

from ..schemas import MAX_DEBTS_PER_USER, DebtCreate, DebtUpdate

__all__ = ["MAX_DEBTS_PER_USER", "DebtLimitReached", "count_debts", "create_debt", "delete_debt", "list_debts", "update_debt"]

_COLUMNS = "id, name, type, balance, apr, minimum_payment, created_at, updated_at"

UPDATABLE_FIELDS = ("name", "type", "balance", "apr", "minimum_payment")


class DebtLimitReached(Exception):
    """Raised when a user already holds MAX_DEBTS_PER_USER debts."""


def count_debts(conn: Connection, user_id: str) -> int:
    return conn.execute(
        text("select count(*) from public.debts where user_id = :user_id"),
        {"user_id": user_id},
    ).scalar_one()


def list_debts(conn: Connection, user_id: str) -> Sequence[Row]:
    return conn.execute(
        text(
            f"select {_COLUMNS} from public.debts "
            "where user_id = :user_id order by created_at, id"
        ),
        {"user_id": user_id},
    ).all()


def create_debt(conn: Connection, user_id: str, data: DebtCreate) -> Row:
    """Insert one debt, enforcing the per-user cap in the same transaction.

    The advisory lock is what makes the cap meaningful. Postgres defaults to
    READ COMMITTED, so without it two concurrent requests at the limit minus
    one would both read a count below the limit and both insert. The lock is
    per-user and transaction-scoped, so it serializes only a single account's
    writes and releases at COMMIT.
    """
    conn.execute(
        text("select pg_advisory_xact_lock(hashtextextended(:user_id, 0))"),
        {"user_id": user_id},
    )
    if count_debts(conn, user_id) >= MAX_DEBTS_PER_USER:
        raise DebtLimitReached(f"a user may store at most {MAX_DEBTS_PER_USER} debts")
    return conn.execute(
        text(
            f"""
            insert into public.debts
              (user_id, name, type, balance, apr, minimum_payment)
            values
              (:user_id, :name, :type, :balance, :apr, :minimum_payment)
            returning {_COLUMNS}
            """
        ),
        {"user_id": user_id, **data.model_dump()},
    ).one()


def update_debt(
    conn: Connection, user_id: str, debt_id: str, changes: DebtUpdate
) -> Row | None:
    """Apply the supplied fields. Returns None when nothing matched.

    None covers both "no such debt" and "not yours" -- the caller must not
    distinguish them, because a 403 would confirm the row exists in someone
    else's account.

    The assignment list is built from the fixed UPDATABLE_FIELDS tuple
    intersected with what the caller supplied, so no caller-controlled string
    ever reaches the SQL text; the values are bound parameters.
    """
    supplied = changes.model_dump(exclude_none=True)
    assignments = ", ".join(
        f"{field} = :{field}" for field in UPDATABLE_FIELDS if field in supplied
    )
    return conn.execute(
        text(
            f"update public.debts set {assignments} "
            "where user_id = :user_id and id = :id "
            f"returning {_COLUMNS}"
        ),
        {"user_id": user_id, "id": debt_id, **supplied},
    ).one_or_none()


def delete_debt(conn: Connection, user_id: str, debt_id: str) -> bool:
    result = conn.execute(
        text("delete from public.debts where user_id = :user_id and id = :id"),
        {"user_id": user_id, "id": debt_id},
    )
    return result.rowcount == 1
