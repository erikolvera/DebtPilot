# DebtPilot roadmap

This roadmap records product directions that are worth preserving but are not
approved for immediate implementation. DebtPilot's current release remains
anonymous and stateless: financial profiles and monthly check-ins stay in the
user's browser.

## Current milestone: local data protection

Backup and restore preserves the anonymous browser-local experience. Users can
export a versioned JSON snapshot, preview and confirm replacement of the complete
plan and check-in history, and recover from visible storage failures. Files stay
on the user's device; this is manual backup, not cloud synchronization.

Validate repeat-user demand for automatic recovery and cross-device continuity
before promoting optional accounts below.

## Later, conditional: optional email accounts

**Decision:** Consider optional passwordless email accounts when user demand
justifies the privacy, security, and operational cost. The product value is
private backup and cross-device continuity, not gating access to the planner.

Implementation should begin only after repeat users—especially people using
monthly check-ins—demonstrate a recurring need for recovery or cross-device
access. Until then, preserve the simpler browser-only experience.

### Product guardrails

- Keep the complete planning and check-in experience available without an
  account. Offer sign-up only after someone has created data worth saving.
- Use a managed authentication provider and passwordless email sign-in. Do not
  build or store passwords in DebtPilot.
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
- Choose the managed authentication and database provider in a dedicated
  security and architecture review once this item is promoted from the
  conditional roadmap.

### Acceptance criteria for promotion and delivery

Promote this item only when user feedback shows recurring demand for plan
recovery or cross-device access and the team is prepared to support stored
financial data.

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

