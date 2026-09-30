# DebtPilot roadmap

This roadmap records product direction and account guardrails. Guest planning
remains anonymous and browser-local. Optional accounts use Supabase Auth and
PostgreSQL for private saving across devices.

## Current milestone: local data protection

Guests retain automatic browser-local saving without manual JSON backup or
restore. Account holders can export their editable plan and check-in history.

Automatic recovery and cross-device continuity motivated the optional account
implementation below.

## Optional email accounts

**Decision:** Add optional email-and-password accounts for private backup and
cross-device continuity. Guest access remains available.

Account storage ships behind a disabled-by-default feature flag until local,
staging, and production security and recovery checks pass.

### Product guardrails

- Keep the complete planning and check-in experience available without an
  account. Offer sign-up only after someone has created data worth saving.
- Use managed authentication for email verification, password handling, and
  password recovery. Do not build or store passwords in DebtPilot.
- Ask for explicit confirmation before copying browser-local data into an
  account. Never silently overwrite an existing cloud plan.
- Persist only the editable financial profile and check-in history. Continue
  recalculating reports through the deterministic API rather than storing
  generated results.
- Keep money represented as decimal strings across every persistence and API
  boundary.
- Treat the account email as authentication data only. Marketing messages and
  reminders require separate, explicit consent.
- Ship export, permanent deletion, user-data isolation, and an updated privacy
  disclosure with the account feature—not as follow-up work.

### First-release boundaries

- One personal plan per account.
- No required sign-up, shared household access, bank connections, marketing
  email, or email reminders.
- Signed-in cloud data is the durable copy; a local cache may support a
  resilient experience but must be cleared on sign-out without deleting the
  cloud copy.
- If local and cloud plans both exist, show an explicit choice instead of
  automatically selecting or merging one.
- Supabase Auth and PostgreSQL are the selected provider. Accounts remain
  optional; guest planning stays available.

### Acceptance criteria for delivery

The user explicitly approved implementation of optional accounts. Hosted
release remains gated on the setup and acceptance checks in `docs/accounts.md`.

When delivered:

- Guests retain today's browser-only workflow with no blocking account prompt.
- A user can opt in, import the current browser's plan once, and open that plan
  on another device.
- Signing out removes synchronized financial data from the device cache without
  deleting the cloud copy.
- Authorization tests prove that one account cannot read or modify another
  account's plan.
- Failed synchronization preserves the last valid local and cloud versions and
  presents a recoverable error.
- Account deletion removes the authentication identity and stored plan data;
  export is available before deletion.
- Existing calculation behavior, deterministic recommendations, and financial
  invariants remain unchanged.
