"""The migration's shape, asserted against the live database.

These fail if the migration is edited in a way that silently removes a
protection, which is exactly the class of change that has no other symptom.
"""

import json
import uuid

from sqlalchemy import create_engine, text

from tests.api.conftest import APP_DB_URL


def test_debts_table_exists(db_conn):
    count = db_conn.execute(
        text("select count(*) from information_schema.tables "
             "where table_schema='public' and table_name='debts'")
    ).scalar_one()
    assert count == 1


def test_row_level_security_is_enabled_and_forced(db_conn):
    # relforcerowsecurity is the one that matters: without it the table's owner
    # bypasses every policy, and nothing else in the suite would notice.
    enabled, forced = db_conn.execute(
        text("select relrowsecurity, relforcerowsecurity "
             "from pg_class where oid = 'public.debts'::regclass")
    ).one()
    assert enabled is True
    assert forced is True


def test_all_four_policies_exist(db_conn):
    names = set(
        db_conn.execute(
            text("select policyname from pg_policies "
                 "where schemaname='public' and tablename='debts'")
        ).scalars()
    )
    assert names == {"debts_select", "debts_insert", "debts_update", "debts_delete"}


def test_update_policy_has_both_using_and_with_check(db_conn):
    using, check = db_conn.execute(
        text("select qual, with_check from pg_policies "
             "where tablename='debts' and policyname='debts_update'")
    ).one()
    assert using is not None
    assert check is not None


def test_money_columns_match_the_api_ceilings(db_conn):
    cols = dict(
        db_conn.execute(
            text("select column_name, numeric_precision from information_schema.columns "
                 "where table_schema='public' and table_name='debts' "
                 "and data_type='numeric'")
        ).all()
    )
    assert cols["balance"] == 10
    assert cols["minimum_payment"] == 10
    assert cols["apr"] == 5


def test_user_id_cascades_on_user_delete(db_conn):
    rule = db_conn.execute(
        text("""
            select rc.delete_rule
            from information_schema.table_constraints tc
            join information_schema.referential_constraints rc
              on tc.constraint_name = rc.constraint_name
            where tc.table_name = 'debts' and tc.constraint_type = 'FOREIGN KEY'
        """)
    ).scalar_one()
    assert rule == "CASCADE"


def test_app_user_is_neither_superuser_nor_rls_exempt(db_conn):
    # Postgres exempts a table's owner from its policies, and a superuser (or
    # any role with BYPASSRLS) bypasses RLS regardless of FORCE. The
    # application must connect as a role that is neither, or every policy in
    # this migration is decorative. This is what keeps that design honest.
    is_super, bypass_rls = db_conn.execute(
        text("select rolsuper, rolbypassrls from pg_roles where rolname = 'app_user'")
    ).one()
    assert is_super is False
    assert bypass_rls is False


def test_clean_debts_actually_deletes(db_engine, user_a):
    # If the privileged connection used for cleanup turned out NOT to bypass
    # RLS (or the table's FORCE flag somehow reached it), `clean_debts` would
    # silently delete nothing and state would leak between tests. Prove the
    # delete lands: insert a row as the admin role, then check it is gone
    # after a cleanup pass identical to the fixture's.
    with db_engine.begin() as conn:
        conn.execute(
            text(
                "insert into public.debts (user_id, name, balance, apr, minimum_payment) "
                "values (:uid, 'test card', 100.00, 20.00, 25.00)"
            ),
            {"uid": user_a},
        )
        count_before = conn.execute(text("select count(*) from public.debts")).scalar_one()
    assert count_before == 1

    with db_engine.begin() as conn:
        conn.execute(text("delete from public.debts"))

    with db_engine.begin() as conn:
        count_after = conn.execute(text("select count(*) from public.debts")).scalar_one()
    assert count_after == 0


def test_app_user_can_resolve_auth_uid():
    # The grant statements assert their own success (they'd raise on a typo),
    # but a `grant ... on schema auth` can execute without error and still
    # grant nothing: Postgres downgrades a grant the runner lacks authority
    # to make into a WARNING, not a failure. Prove the privilege actually
    # landed by having app_user itself call auth.uid(), the same way the RLS
    # policies on public.debts do.
    user_id = str(uuid.uuid4())
    engine = create_engine(APP_DB_URL, future=True)
    try:
        with engine.begin() as conn:
            conn.execute(
                text("select set_config('request.jwt.claims', :claims, true)"),
                {"claims": json.dumps({"sub": user_id})},
            )
            resolved = conn.execute(text("select auth.uid()")).scalar_one()
        assert str(resolved) == user_id
    finally:
        engine.dispose()
