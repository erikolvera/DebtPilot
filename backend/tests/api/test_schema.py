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


def test_app_user_can_resolve_the_request_user_id():
    """The policies call public.request_user_id(), so app_user must be able to.

    This is the test that would have caught the original defect: the migration's
    `grant usage on schema auth` ran without error but granted nothing, so
    asserting the statement executed proved nothing. Only exercising the
    privilege as app_user does.
    """
    engine = create_engine(APP_DB_URL, future=True)
    try:
        with engine.begin() as conn:
            assert conn.execute(text("select public.request_user_id()")).scalar_one() is None
            user_id = "11111111-1111-1111-1111-111111111111"
            conn.execute(
                text("select set_config('request.jwt.claims', :c, true)"),
                {"c": '{"sub": "%s"}' % user_id},
            )
            assert str(conn.execute(text("select public.request_user_id()")).scalar_one()) == user_id
    finally:
        engine.dispose()


def test_app_user_has_no_privileges_on_other_public_tables(db_conn):
    """app_user must not inherit access to tables it was never granted.

    Membership in Supabase's `authenticated` role would have given exactly
    that -- measured: select and insert on a brand-new public table with no
    RLS -- which is why the policies use our own function instead.
    """
    db_conn.execute(text("create table public.privilege_probe (id int)"))
    try:
        for privilege in ("select", "insert", "update", "delete"):
            granted = db_conn.execute(
                text("select has_table_privilege('app_user', 'public.privilege_probe', :p)"),
                {"p": privilege},
            ).scalar_one()
            assert granted is False, f"app_user unexpectedly has {privilege}"
    finally:
        db_conn.execute(text("drop table public.privilege_probe"))
