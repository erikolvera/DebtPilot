"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { initialData, readLocalData, writeLocalData, type DataStorage, type LocalData } from "@/lib/localData";

function storage(): DataStorage | null {
  try { return window.localStorage; } catch { return null; }
}
type DataContext = {
  data: LocalData; ready: boolean; error: string | null;
  update: (change: (data: LocalData) => LocalData, requireSave?: boolean) => boolean;
  retry: () => boolean;
};
const Context = createContext<DataContext | null>(null);
export function LocalDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState(initialData);
  const current = useRef(data);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingBlocked, setSavingBlocked] = useState(false);
  const blocked = useRef(false);
  useEffect(() => {
    const loaded = readLocalData(storage());
    current.current = loaded.data;
    blocked.current = loaded.blocked;
    // Hydrate browser-only state once the shared provider mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(loaded.data);
    setError(loaded.error);
    setSavingBlocked(loaded.blocked);
    setReady(true);
  }, []);
  function persist(next: LocalData) {
    if (blocked.current) return false;
    const saved = writeLocalData(storage(), next);
    setError(saved ? null : "This browser could not save your data. Changes are only available during this visit.");
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
  return <Context.Provider value={{ data, ready, error, update, retry: () => persist(current.current) }}>
    {ready && error && <aside role="alert" className="mx-auto max-w-5xl rounded-2xl bg-coral-soft p-4 text-sm">
      <p>{error}</p>
      {!savingBlocked && <button className="secondary-button mt-3 px-4" onClick={() => persist(current.current)}>Retry saving</button>}
    </aside>}
    {children}
  </Context.Provider>;
}
export function useLocalData() {
  const context = useContext(Context);
  if (!context) throw new Error("LocalDataProvider is required");
  return context;
}
