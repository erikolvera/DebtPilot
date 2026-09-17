"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createBackup, downloadJson, initialData, readLocalData, writeLocalData, type DataStorage, type LocalData } from "@/lib/localData";

function storage(): DataStorage | null {
  try { return window.localStorage; } catch { return null; }
}
type DataContext = {
  data: LocalData; ready: boolean; error: string | null; recovery: Record<string, string> | null;
  update: (change: (data: LocalData) => LocalData, requireSave?: boolean) => boolean;
  restore: (data: LocalData) => boolean;
  retry: () => boolean;
  download: () => void;
};
const Context = createContext<DataContext | null>(null);
export function LocalDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState(initialData);
  const current = useRef(data);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<Record<string, string> | null>(null);
  const blocked = useRef(false);
  useEffect(() => {
    const loaded = readLocalData(storage());
    current.current = loaded.data;
    blocked.current = loaded.recovery !== null;
    // Hydrate browser-only state once the shared provider mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(loaded.data);
    setError(loaded.error);
    setRecovery(loaded.recovery);
    setReady(true);
  }, []);
  function persist(next: LocalData) {
    if (blocked.current) return false;
    const saved = writeLocalData(storage(), next);
    setError(saved ? null : "This browser could not save your data. Your changes are available during this visit; download a backup before leaving.");
    return saved;
  }
  function update(change: (data: LocalData) => LocalData, requireSave = false) {
    const next = change(current.current);
    const saved = persist(next);
    if (requireSave && !saved) return false;
    current.current = next;
    setData(next);
    return saved;
  }
  function restore(next: LocalData) {
    if (!writeLocalData(storage(), next)) {
      setError("Restore failed because this browser could not save the backup. Your current data has not been replaced.");
      return false;
    }
    current.current = next;
    blocked.current = false;
    setData(next);
    setRecovery(null);
    setError(null);
    return true;
  }
  function download() {
    downloadJson(createBackup(current.current), `debtpilot-backup-${new Date().toISOString().slice(0, 10)}.json`);
  }
  return <Context.Provider value={{ data, ready, error, recovery, update, restore, retry: () => persist(current.current), download }}>
    {ready && error && <aside role="alert" className="mx-auto max-w-5xl rounded-2xl bg-coral-soft p-4 text-sm">
      <p>{error}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        {!recovery && <button className="secondary-button px-4" onClick={() => persist(current.current)}>Retry saving</button>}
        <button className="secondary-button px-4" onClick={download}>Download backup</button>
        {recovery && <button className="secondary-button px-4" onClick={() => downloadJson(JSON.stringify(recovery, null, 2), "debtpilot-recovery.json")}>Download recovery file</button>}
      </div>
      {recovery && <p className="mt-2">The recovery file preserves the original stored text for troubleshooting; it is not a restorable backup.</p>}
    </aside>}
    {children}
  </Context.Provider>;
}
export function useLocalData() {
  const context = useContext(Context);
  if (!context) throw new Error("LocalDataProvider is required");
  return context;
}
