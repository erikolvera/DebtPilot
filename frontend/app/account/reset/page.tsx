"use client";

import { useState, type FormEvent } from "react";
import { browserClient } from "@/lib/cloud/browser";

export default function ResetPage() {
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 12) { setNotice("Use at least 12 characters."); return; }
    const client = browserClient();
    if (!client) return;
    const { data } = await client.auth.getUser();
    if (!data.user) { setNotice("Request a new password reset link."); return; }
    const { error } = await client.auth.updateUser({ password });
    setNotice(error ? "Password could not be changed. Request a new link." : "Password changed. Return to your account.");
  }
  return <main className="mx-auto max-w-xl px-5 py-16"><h1 className="font-display text-3xl">Set a new password</h1><form className="mt-5 space-y-4" onSubmit={(event) => { void submit(event); }}><label className="block">New password<input className="mt-2 block w-full rounded-xl border p-3" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary-button px-5">Update password</button></form>{notice && <p role="status" className="mt-4">{notice}</p>}</main>;
}
