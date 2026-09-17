"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useLocalData } from "@/components/LocalDataProvider";
import { MAX_BACKUP_BYTES, parseBackup, type LocalData } from "@/lib/localData";

type Preview = { data: LocalData; exportedAt: string };
export default function DataPage() {
  const { ready, download, restore } = useLocalData();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selection = useRef(0);
  if (!ready) return <main className="mx-auto max-w-5xl px-5 py-16">Loading your data…</main>;
  return <main className="mx-auto max-w-5xl space-y-6 px-5 py-12">
    <div><p className="eyebrow text-primary">Private by default</p><h1 className="mt-3 font-display text-4xl font-semibold">Your data</h1>
      <p className="mt-4 max-w-prose text-ink-soft">Your plan and monthly check-ins live in this browser. A backup is a snapshot you can restore here or on another device. Download a new one after making changes.</p></div>
    <section className="panel space-y-4" aria-labelledby="backup-heading">
      <h2 id="backup-heading" className="font-display text-2xl font-semibold">Download backup</h2>
      <p className="text-sm text-ink-soft">Includes your income, expenses, debts, strategy, and retained check-in history, including changes this browser could not save. The JSON file is unencrypted and contains personal financial information. Keep it somewhere private. Nothing is uploaded.</p>
      <button className="primary-button px-5" onClick={download}>Download backup</button>
    </section>
    <section className="panel space-y-4" aria-labelledby="restore-heading">
      <h2 id="restore-heading" className="font-display text-2xl font-semibold">Restore backup</h2>
      <p className="text-sm text-ink-soft">Choose a DebtPilot JSON backup (up to 5 MiB). You can review it before replacing this browser’s entire plan and check-in history.</p>
      <label className="block text-sm font-medium">Backup file
        <input className="mt-2 block w-full rounded-xl border border-rule p-3" type="file" accept=".json,application/json" onChange={async (event) => {
          const token = ++selection.current;
          const file = event.target.files?.[0];
          setPreview(null); setConfirmed(false); setError(null); setMessage(null);
          if (!file) return;
          try {
            if (file.size > MAX_BACKUP_BYTES) throw new Error("Choose a backup smaller than 5 MiB.");
            const text = await file.text();
            const data = parseBackup(text);
            if (token !== selection.current) return;
            setPreview({ data, exportedAt: (JSON.parse(text) as { exportedAt: string }).exportedAt });
          } catch (cause) {
            if (token === selection.current) setError(cause instanceof Error ? cause.message : "This file could not be read.");
          }
        }} />
      </label>
      {preview && <div className="space-y-4 rounded-2xl bg-paper p-4">
        <h3 className="font-semibold">Review backup</h3>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt>Exported</dt><dd>{new Date(preview.exportedAt).toLocaleString()}</dd>
          <dt>Income entries</dt><dd>{preview.data.profile.incomes.length}</dd>
          <dt>Expenses</dt><dd>{preview.data.profile.expenses.length}</dd>
          <dt>Debts</dt><dd>{preview.data.profile.debts.length}</dd>
          <dt>Check-ins</dt><dd>{preview.data.checkIns.snapshots.length}</dd>
          <dt>Check-in months</dt><dd>{preview.data.checkIns.snapshots.length ? `${preview.data.checkIns.snapshots[0].month} to ${preview.data.checkIns.snapshots.at(-1)!.month}` : "None"}</dd>
        </dl>
        <button className="secondary-button px-4" onClick={download}>Download current data first</button>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Replace my entire plan and check-in history in this browser with this backup.</label>
        <div className="flex flex-wrap gap-3">
          <button className="primary-button px-5 disabled:opacity-50" disabled={!confirmed} onClick={() => {
            if (!confirmed) return;
            if (restore(preview.data)) {
              setPreview(null); setConfirmed(false); setError(null);
              setMessage("Backup restored. Your plan and check-ins are saved in this browser.");
            } else setError("Restore failed. Your current plan and check-ins have not been replaced. You can retry after freeing browser storage.");
          }}>Replace and restore</button>
          <button className="secondary-button px-5" onClick={() => { selection.current++; setPreview(null); setConfirmed(false); setError(null); }}>Cancel</button>
        </div>
      </div>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <div role="status"><p>{message}</p><Link className="secondary-button mt-3 px-5" href="/report">View recalculated report</Link></div>}
    </section>
  </main>;
}
