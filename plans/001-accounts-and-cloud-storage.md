# 001 — Optional accounts and cloud storage

Planned at `c19113d`, 2026-09-29. User selected optional email/password accounts and preservation of offline edits for retry. This promotes the conditional roadmap item and supersedes its passwordless preference.

## Objective and boundaries

Use Supabase Auth and PostgreSQL, one plan per account, while retaining complete guest planning. Next.js owns account UI, sessions, authenticated persistence, and synchronization. FastAPI remains the stateless calculation API. Preserve all Decimal/string money rules and financial calculation behavior. Do not add bank connections, shared accounts, marketing messages, or stored full reports.

## Database and API

- Versioned migrations and local Supabase configuration. A `plans` table has `user_id` UUID PK referencing auth.users with cascade deletion; `data` JSONB containing existing LocalData `{version:1,profile,checkIns}`; positive incrementing `revision`; `last_mutation_id` UUID; database timestamps. Keep incomplete editable strings and historical check-in summaries. Enforce document version and 1 MiB cloud document limit.
- RLS restricts each authenticated user to their own existing-auth-user row; no guest access. Deleted-user tokens cannot recreate data. Verify isolation directly against the database.
- `GET /api/plan` returns `{data,revision,updatedAt,lastMutationId}` or 404. `PUT /api/plan` accepts `{data,expectedRevision,mutationId}`; null revision creates only, integer revision updates atomically on match; conflicts 409, unauthenticated 401, invalid 422, oversized 413. Owner always comes from verified auth. Read back mutation ID after uncertain writes to detect already-committed retries.
- Bounded body reading and existing document validators on server. Authenticated user client for normal persistence; server-only administrative credential only for account deletion. No-store responses, same-origin mutation protection, no sensitive payload/token/password logging.
- `DELETE /api/account` requires password revalidation and explicit confirmation; delete auth identity and cascade data. Clear local state after confirmed success.

## Ordered implementation

1. Add Supabase SDK/SSR clients, environment examples, migrations, generated DB types, feature flag disabled by default, sign-up/verification/resend/login/forgot/reset/account/sign-out. Minimum 12 character passwords; allow paste/autofill; generic auth responses; configured callbacks and safe relative returns. Require verified email for cloud access. Read installed Next.js documentation and current official Supabase SSR/password docs. Guest app/build works with feature off and no Supabase settings. Verify local migration, auth, refresh and RLS isolation.
2. Add persistence endpoints and atomic revision checks, validation and meaningful database integration tests. Cloud documents reject >1 MiB before mutation. Unsupported data versions fail without overwriting. Verify concurrent updates yield one success/one conflict, malformed/oversized/unauthorized saves leave data unchanged.
3. Refactor LocalDataProvider and callers to explicit async persistence: update(change):void for editable drafts; flush():Promise<SaveResult>; commit(change):Promise<SaveResult> for actions needing durability before replacing visible state; loading/saved/saving/unsynced/conflict/error states. Preserve guest keys/migrations/corruption recovery. Update check-in submission, history clearing, retry and all consumers.
   - Account cache key includes verified user ID, with draft/base revision/mutation ID/dirty state/last acknowledged document. Local save immediately, cloud debounce 750ms, serialize requests, preserve edits made in-flight, discard late responses after identity changes. Retry online/manual, refresh on focus only when clean. Storage failure retains in-memory edits and offers export without promising restart recovery.
   - Never auto-upload guest data. No cloud row: offer upload guest or empty cloud. Both versions: preview and explicit choice/replacement confirmation. Remove imported guest copy only after successful upload and disclose this; choosing cloud leaves unrelated guest data separate. Dirty cache resumes only against base revision. Conflict pauses sync; offer use cloud/confirmed replace cloud/export draft with revision recheck. No automatic merging.
4. Optional save entry points; accurate guest/account data/privacy text; export includes unsaved edits. Pending edits at sign-out offer retry/export/explicit discard. Sign-out clears account caches/reports across tabs, preserving guest/cloud copies. Expiry locks account cache until reauthentication and stops writes; never silently switch to guest on auth outage. Deletion offers export, requires reauthentication/confirmation, clears data only on confirmed success; document infrastructure backup retention honestly. Update roadmap/engineering docs.

## Verification

- Existing gates: backend `.venv/bin/pytest`; frontend `npm test`, `npm run typecheck`, `npm run lint`, `NEXT_PUBLIC_API_BASE_URL=https://api.example.invalid npm run build`.
- New documented `test:integration` and `test:e2e` scripts, disposable local Supabase and Playwright tests, CI covering supabase migration paths. Pure synchronization tests follow existing Vitest patterns.
- Cover legacy/corrupt guest storage, account JSON export, auth/verification/reset/expiry, account isolation/direct database access, second-browser load, imports, concurrent tabs/conflicts/lost acknowledgments/in-flight edits, offline restart/quota/auth expiry, failed check-in, sign-out cleanup, deletion and string money.

## Release gates

Separate staging/production projects; verified SMTP sender, exact callbacks, rate limits and deployment secrets; staging two-account end-to-end acceptance; configured backups and restore drill. Apply migrations before feature enablement. Monitor failures/conflicts without sensitive data. Rollback disables cloud writes and entry points but preserves data and shows unavailable state for account sessions.

## Executor instructions

Implement in order, preserve unrelated files (including existing untracked output/), read AGENTS.md, and verify actual results. Scope: frontend, supabase, CI and relevant docs. Do not alter financial engine/contracts. If provider/SMTP/deployment access is absent, finish local work and record exact outstanding setup; never claim production complete. Reconcile any drift from c19113d before edits. Reviewer maintains this index.

## Scope amendment

The user removed guest backup and restore. Guest planning retains automatic
browser-local saving and corruption protection. JSON export is available only
through account workflows; no JSON restore page is provided.

## Implementation verification

Implemented optional Supabase authentication, owner-isolated plan storage,
atomic revision updates, account export/deletion, and separate guest/account
cache handling. Guest backup and restore were removed per the scope amendment.

- Frontend: 106 unit tests, type checking, lint, and production build passed.
- Local PostgreSQL integration: owner isolation, direct-write restrictions,
  concurrent/stale revisions, size/decimal-string constraints, and deletion passed.
- Local HTTP workflows: authenticated create/load/save, origin checks, malformed
  and oversized documents, password revalidation, and deletion passed.
- Backend: 260 tests passed, 98.72% coverage; calculation code unchanged.

Hosted Supabase provisioning, SMTP verification/reset delivery, and the staging
browser acceptance checks in `docs/accounts.md` remain release requirements.
The feature is disabled by default and has not been deployed.

PR review also hardened expired-session handling so account drafts cannot be
retried into guest storage, guarded late identity-transition responses, and
kept account/reset pages accessible during the import/conflict choice.
