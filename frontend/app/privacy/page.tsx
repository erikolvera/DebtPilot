import Link from "next/link";

export default function PrivacyPage() {
  return <main className="mx-auto max-w-3xl space-y-7 px-5 py-12">
    <h1 className="font-display text-4xl font-semibold">Your data in DebtPilot</h1>
    <section className="space-y-3"><h2 className="font-display text-2xl">Planning as a guest</h2><p>Your editable plan and check-in history are saved in this browser. Calculating a report sends your financial snapshot to the calculation API, which calculates the result without saving a financial profile.</p></section>
    <section className="space-y-3"><h2 className="font-display text-2xl">Optional accounts</h2><p>If you choose an account, Supabase handles email sign-in, verification, password recovery, and password storage. Your editable income, expenses, debts, strategy, and check-in history are stored in the account database. Uploading an existing browser plan requires your confirmation.</p><p>Signed-in plans also have a separate browser cache so unsynced edits can survive a lost connection. Your account email is used for authentication and recovery; the account feature does not send marketing messages.</p></section>
    <section className="space-y-3"><h2 className="font-display text-2xl">Export and deletion</h2><p>Signed-in users can download a JSON backup, including unsynced edits. The file is unencrypted and contains financial information; keep it private. Signing out clears synchronized data from this device while retaining the cloud copy. Guest data that you have not imported stays separate.</p><p>Deleting an account removes its authentication identity and live cloud plan. Copies in infrastructure backups may remain until those backups expire. Download any data you want to keep before deletion.</p></section>
    <p><Link href="/plan/cash-flow" className="font-semibold underline">Plan as a guest</Link> · <Link href="/account" className="font-semibold underline">Manage your account</Link></p>
  </main>;
}
