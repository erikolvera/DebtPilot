# Optional account setup and release

Guest mode needs no Supabase environment variables. To enable accounts locally,
start Docker and run `supabase start` at the repository root. The configuration
uses ports 55321–55324 to avoid other local projects. Obtain the local URL and
keys with `supabase status -o env`. Copy `frontend/.env.example` to
`frontend/.env.local` and set:

```text
NEXT_PUBLIC_CLOUD_ACCOUNTS=true
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
SUPABASE_SECRET_KEY=<local secret key>
```

The secret key is server-only and is used solely for permanent account deletion.
Never put it in a `NEXT_PUBLIC_` variable or commit it. Start the frontend with
`cd frontend && npm run dev`; the API used for reports still runs separately.
For a clean database run `supabase db reset --yes` **only against the disposable
local project**. This destroys local test data.

Run `cd frontend && npm run test:integration && npm run test:e2e` with local
Supabase running. The scripts create and delete disposable accounts and test
RLS, revision conflicts, HTTP authentication, origin checks, and cascading
deletion. CI runs these alongside unit, type, lint, and build checks. Use
`npm run dev:cloud` to launch the account-enabled frontend with local keys.

Before enabling production accounts, provision separate staging and production
Supabase projects. Apply the checked-in migration to staging and test sign-up,
email verification, password reset, import, second-device loading, conflicts,
sign-out, export, and deletion with two accounts. Configure a verified SMTP sender,
exact authentication callback URLs, password/rate-limit settings, database
backups, and a tested restore procedure. Run the same acceptance checks in
production before setting `NEXT_PUBLIC_CLOUD_ACCOUNTS=true` and deploying the
frontend. Configure a privacy disclosure and record actual backup retention;
deletion removes live account data but backups may retain it temporarily.

If accounts must be disabled, deploy with `NEXT_PUBLIC_CLOUD_ACCOUNTS=false`.
Do not delete the database. Existing guests continue to use browser data; tell
signed-in users cloud saving is temporarily unavailable rather than treating
their cached account plan as a guest plan.
