"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { browserClient } from "@/lib/cloud/browser";
import { accountsEnabled } from "@/lib/cloud/config";
import { useLocalData } from "@/components/LocalDataProvider";

type Mode = "login" | "signup" | "forgot";

export default function AccountPage() {
  const router = useRouter();
  const { accountId, status, signOut, download } = useLocalData();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [verify, setVerify] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const client = browserClient();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    setWorking(true); setNotice("");
    const callback = `${window.location.origin}/auth/callback`;
    try {
      if (mode === "forgot") {
        await client.auth.resetPasswordForEmail(email, { redirectTo: `${callback}?type=recovery` });
        setNotice("If this email has an account, a password reset link is on its way.");
      } else if (mode === "signup") {
        if (password.length < 12) { setNotice("Use a password with at least 12 characters."); return; }
        const { error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: callback } });
        setNotice(error ? "Sign-up could not be completed. Please try again." : "Check your email to verify your account.");
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) { setVerify(error.code === "email_not_confirmed"); setNotice("Email or password was not accepted. Check your inbox if verification is pending."); }
        else if (!data.user?.email_confirmed_at) { setVerify(true); setNotice("Verify your email before saving a plan."); }
        else setNotice("Signed in. Your plan is loading.");
      }
    } finally { setWorking(false); }
  }
  async function resend() {
    if (!client) return;
    await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setNotice("If verification is pending, a new email is on its way.");
  }
  async function deleteAccount() {
    if (!deleteConfirm || !deletePassword) return;
    setDeleteWorking(true); setNotice("");
    try {
      const response = await fetch("/api/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: deletePassword, confirmation: "DELETE" }) });
      if (response.ok) { await signOut(true); router.push("/"); }
      else setNotice("Deletion failed. Check your password and try again; your account is still available.");
    } catch { setNotice("Deletion failed. Try again when connected."); }
    finally { setDeleteWorking(false); setDeletePassword(""); }
  }
  return <main className="mx-auto max-w-2xl space-y-8 px-5 py-12">
    <div><p className="eyebrow text-primary">Optional cloud saving</p><h1 className="mt-2 font-display text-4xl font-semibold">{accountId ? "Your account" : "Sign up or log in"}</h1><p className="mt-3 text-ink-soft">Keep planning as a guest, or save one personal plan across devices. Email is used for sign-in and recovery.</p><Link href="/privacy" className="mt-3 inline-block text-sm underline">How your financial data is stored</Link></div>
    {!accountsEnabled && <aside role="status" className="rounded-xl border border-rule bg-paper p-4">
      <p className="font-semibold">Account saving is not available yet</p>
      <p className="mt-2 text-sm text-ink-soft">You can keep planning in this browser. Sign-up and log-in will be available when cloud saving is ready.</p>
      <Link href="/report" className="mt-3 inline-block font-semibold underline">Return to your report</Link>
    </aside>}
    {notice && <p role="status" className="rounded-xl bg-paper p-4">{notice}</p>}
    {accountId ? <>
      <section className="panel space-y-4"><h2 className="font-display text-2xl">Your saved plan</h2><p>Sync status: {status}</p><button className="secondary-button px-4" onClick={download}>Download JSON backup</button><button className="secondary-button ml-2 px-4" onClick={() => { void signOut(); }}>Sign out</button></section>
      <section className="panel space-y-4"><h2 className="font-display text-2xl">Delete account</h2><p>Deletion removes your sign-in and cloud plan. Download a backup first if you want to keep your data.</p><label className="block">Confirm your password<input className="mt-2 block w-full rounded-xl border p-3" type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} /></label><label className="flex gap-2"><input type="checkbox" checked={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.checked)} />I understand this deletes my account and cloud plan.</label><button className="secondary-button px-4" disabled={!deleteConfirm || !deletePassword || deleteWorking} onClick={() => { void deleteAccount(); }}>Delete my account</button></section>
    </> : <section className="panel space-y-4"><div className="flex gap-4"><button className="font-semibold underline" aria-pressed={mode === "login"} onClick={() => { setMode("login"); setNotice(""); }}>Log in</button><button className="font-semibold underline" aria-pressed={mode === "signup"} onClick={() => { setMode("signup"); setNotice(""); }}>Sign up</button><button className="font-semibold underline" aria-pressed={mode === "forgot"} onClick={() => { setMode("forgot"); setNotice(""); }}>Reset password</button></div><h2 className="font-display text-2xl">{mode === "signup" ? "Create an account" : mode === "forgot" ? "Reset your password" : "Welcome back"}</h2><form onSubmit={(event) => { void submit(event); }}><fieldset className="space-y-4 disabled:opacity-60" disabled={!accountsEnabled || working}><legend className="sr-only">{mode === "signup" ? "Create an account" : mode === "forgot" ? "Reset your password" : "Log in"}</legend><label className="block">Email<input required className="mt-2 block w-full rounded-xl border p-3" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{mode !== "forgot" && <label className="block">Password<input required className="mt-2 block w-full rounded-xl border p-3" type="password" minLength={mode === "signup" ? 12 : undefined} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}<button disabled={working} className="primary-button px-5">{mode === "signup" ? "Sign up" : mode === "forgot" ? "Send reset link" : "Log in"}</button></fieldset></form>{verify && <button className="secondary-button px-4" onClick={() => { void resend(); }}>Resend verification email</button>}</section>}
  </main>;
}
