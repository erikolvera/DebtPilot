"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { browserClient } from "@/lib/cloud/browser";
import { accountsEnabled } from "@/lib/cloud/config";
import { accountKey, documentsEqual, loadPlan, pendingDisposition, readPending, savePlan, writePending, type CloudPlan, type SaveResult } from "@/lib/cloud/plan";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { initialData, readLocalData, writeLocalData, type DataStorage, type LocalData } from "@/lib/localData";

import { createBackup, downloadJson } from "@/lib/cloud/export";

function storage(): DataStorage | null { try { return window.localStorage; } catch { return null; } }
type Choice = { browser: LocalData; cloud: CloudPlan | null; fromCache: boolean };
type SaveState = "loading" | "saved" | "saving" | "unsynced" | "conflict";
type DataContext = {
  data: LocalData; ready: boolean; error: string | null;
  status: SaveState; accountId: string | null; choice: Choice | null;
  update: (change: (data: LocalData) => LocalData) => void;
  commit: (change: (data: LocalData) => LocalData, queueOnFailure?: boolean) => Promise<SaveResult>;
  flush: () => Promise<SaveResult>; retry: () => Promise<SaveResult>;
  choose: (selection: "browser" | "cloud" | "empty") => Promise<SaveResult>;
  signOut: (discard?: boolean) => Promise<void>; download: () => void;
};
const Context = createContext<DataContext | null>(null);
const lastAccountKey = "debtpilot.account.last";
function hasLastAccount() { try { return typeof storage()?.getItem(lastAccountKey) === "string"; } catch { return false; } }
const changed = (data: LocalData) => JSON.stringify(data) !== JSON.stringify(initialData());
const ignoredGuestKey = (id: string) => `debtpilot.guest-choice.${id}`;
function ignoredGuest(id: string, data: LocalData) {
  try { return localStorage.getItem(ignoredGuestKey(id)) === JSON.stringify(data); }
  catch { return false; }
}

export function LocalDataProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [data, setData] = useState(initialData);
  const current = useRef(data);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingBlocked, setSavingBlocked] = useState(false);
  const [status, setStatus] = useState<SaveState>("loading");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const identity = useRef<string | null>(null);
  const revision = useRef<number | null>(null);
  const dirty = useRef(false);
  const paused = useRef(false);
  const loadFailed = useRef(false);
  const blocked = useRef(false);
  const pending = useRef<Promise<SaveResult> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const intentionalSignOut = useRef(false);
  const guest = useRef(initialData());
  const setCurrent = useCallback((next: LocalData) => { current.current = next; setData(next); }, []);
  const cache = useCallback((mutationId: string | null, acknowledged?: LocalData) => {
    const id = identity.current;
    return id ? writePending(id, { data: current.current, revision: revision.current, dirty: dirty.current, mutationId, acknowledged }) : true;
  }, []);

  const lockAccount = useCallback(() => {
      generation.current++; identity.current = null; setAccountId(null);
      if (timer.current) clearTimeout(timer.current);
      paused.current = true; blocked.current = true; dirty.current = false;
      setCurrent(initialData()); setChoice(null); setSavingBlocked(true);
      setUnavailable(true); setReady(true); setStatus("unsynced");
      setError("Your account session expired. Sign in again to unlock your saved plan.");
  }, [setCurrent]);

  const flush = useCallback(async (): Promise<SaveResult> => {
    const id = identity.current;
    const invocation = generation.current;
    if (!id && blocked.current) return { ok: false, reason: "storage" };
    if (!id) {
      const saved = writeLocalData(storage(), current.current);
      setStatus(saved ? "saved" : "unsynced");
      setError(saved ? null : "This browser could not save your data. Changes remain available during this visit.");
      return saved ? { ok: true } : { ok: false, reason: "storage" };
    }
    if (paused.current) return { ok: false, reason: "conflict" };
    if (pending.current) {
      const prior = await pending.current;
      if (identity.current !== id || generation.current !== invocation) return { ok: false, reason: "auth" };
      if (!prior.ok) return prior;
      if (!dirty.current) return { ok: true };
    }
    if (!dirty.current) return { ok: true };
    const uncertain = readPending(id);
    if (uncertain?.mutationId) {
      const observed = await loadPlan();
      if (identity.current !== id || generation.current !== invocation) return { ok: false, reason: "auth" };
      if (observed.error === "auth") lockAccount();
      if (observed.error) return { ok: false, reason: observed.error };
      if (observed.plan?.lastMutationId === uncertain.mutationId) {
        revision.current = observed.plan.revision;
        dirty.current = !documentsEqual(current.current, observed.plan.data);
        cache(null, observed.plan.data);
        if (!dirty.current) { setStatus("saved"); setError(null); return { ok: true }; }
      }
    }
    const captured = current.current;
    const base = revision.current;
    const guard = generation.current;
    const mutationId = crypto.randomUUID();
    cache(mutationId); setStatus("saving");
    const promise: Promise<SaveResult> = (async () => {
      let result = await savePlan(captured, base, mutationId);
      if (result.error === "network") {
        const observed = await loadPlan();
        if (observed.plan?.lastMutationId === mutationId) result = { plan: observed.plan, error: null };
      }
      if (identity.current !== id || generation.current !== guard) return { ok: false, reason: "auth" };
      if (result.error === "conflict") {
        paused.current = true; setStatus("conflict"); setError("Your cloud plan changed. Choose which version to keep.");
        const observed = await loadPlan();
        if (identity.current !== id || generation.current !== guard) return { ok: false, reason: "auth" };
        setChoice({ browser: current.current, cloud: observed.plan, fromCache: true });
        return { ok: false, reason: "conflict" };
      }
      if (result.error === "auth") { lockAccount(); return { ok: false, reason: "auth" }; }
      if (result.error || !result.plan) {
        setStatus("unsynced"); setError(result.error === "too_large" ? "This plan exceeds the 1 MiB cloud limit. Download a backup and reduce the plan before retrying." : "Cloud saving failed. Retry or download a backup.");
        return { ok: false, reason: result.error ?? "network" };
      }
      revision.current = result.plan.revision;
      dirty.current = current.current !== captured;
      const cached = cache(null, result.plan.data);
      setStatus(dirty.current || !cached ? "unsynced" : "saved");
      setError(cached ? null : "Saved online, but this browser could not cache your plan.");
      return { ok: true };
    })();
    pending.current = promise;
    const result = await promise;
    pending.current = null;
    return result;
  }, [cache, lockAccount]);

  const update = useCallback((change: (data: LocalData) => LocalData) => {
    if (paused.current) return;
    const next = change(current.current);
    setCurrent(next);
    if (blocked.current && !identity.current) { setStatus("unsynced"); return; }
    if (identity.current) {
      dirty.current = true;
      if (!cache(null)) setError("This browser could not cache changes. Download a backup before leaving.");
      setStatus("unsynced");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush(); }, 750);
    } else {
      const saved = writeLocalData(storage(), next);
      setStatus(saved ? "saved" : "unsynced");
      setError(saved ? null : "This browser could not save your data. Changes remain available during this visit.");
    }
  }, [cache, flush, setCurrent]);

  const commit = useCallback(async (change: (data: LocalData) => LocalData, queueOnFailure = false): Promise<SaveResult> => {
    if (blocked.current || paused.current) return { ok: false, reason: "conflict" };
    if (!identity.current) {
      const next = change(current.current);
      if (!writeLocalData(storage(), next)) return { ok: false, reason: "storage" };
      setCurrent(next); setError(null); return { ok: true };
    }
    const outstanding = await flush();
    if (!outstanding.ok) {
      if (queueOnFailure && outstanding.reason === "network") update(change);
      return outstanding;
    }
    const id = identity.current;
    if (!id) return { ok: false, reason: "auth" };
    const before = current.current;
    const next = change(before);
    const mutationId = crypto.randomUUID();
    const guard = generation.current;
    setStatus("saving");
    let result = await savePlan(next, revision.current, mutationId);
    if (result.error === "network") {
      const observed = await loadPlan();
      if (observed.plan?.lastMutationId === mutationId) result = { plan: observed.plan, error: null };
    }
    if (identity.current !== id || generation.current !== guard) return { ok: false, reason: "auth" };
    if (result.error === "conflict") {
      paused.current = true;
      const observed = await loadPlan();
      if (identity.current !== id || generation.current !== guard) return { ok: false, reason: "auth" };
      setChoice({ browser: next, cloud: observed.plan, fromCache: true });
      setStatus("conflict"); setError("Your cloud plan changed. Choose which version to keep.");
      return { ok: false, reason: "conflict" };
    }
    if (result.error === "auth") { lockAccount(); return { ok: false, reason: "auth" }; }
    if (result.error || !result.plan) {
      if (queueOnFailure && result.error === "network") update(() => next);
      setStatus("unsynced"); setError(result.error === "too_large" ? "This plan exceeds the 1 MiB cloud limit. Download a backup and reduce the plan." : "This action could not be saved. Retry when connected.");
      return { ok: false, reason: result.error ?? "network" };
    }
    revision.current = result.plan.revision;
    setCurrent(current.current === before ? next : change(current.current));
    dirty.current = current.current !== next;
    cache(null, next);
    setStatus(dirty.current ? "unsynced" : "saved"); setError(null);
    if (dirty.current) timer.current = setTimeout(() => { void flush(); }, 750);
    return { ok: true };
  }, [cache, flush, lockAccount, setCurrent, update]);

  const choose = useCallback(async (selection: "browser" | "cloud" | "empty"): Promise<SaveResult> => {
    if (!choice || !identity.current) return { ok: false, reason: "auth" };
    if (selection === "cloud" && choice.cloud) {
      revision.current = choice.cloud.revision; dirty.current = false; paused.current = false;
      setCurrent(choice.cloud.data); cache(null); setChoice(null); setStatus("saved"); setError(null);
      if (!choice.fromCache) {
        try { localStorage.setItem(ignoredGuestKey(identity.current), JSON.stringify(choice.browser)); } catch { /* Repeat the choice next visit. */ }
      }
      return { ok: true };
    }
    const selected = selection === "empty" ? initialData() : choice.browser;
    revision.current = choice.cloud?.revision ?? null; dirty.current = true; paused.current = false;
    setCurrent(selected); cache(null); setChoice(null);
    const result = await flush();
    if (result.ok && selection === "browser" && !choice.fromCache) {
      try { storage()?.removeItem("debtpilot.data.v1"); } catch { /* Cloud is saved. */ }
    }
    return result;
  }, [cache, choice, flush, setCurrent]);

  const signOut = useCallback(async (discard = false) => {
    if (dirty.current && !discard && !window.confirm("Changes are not synced. Download a backup before signing out, or choose OK to discard them.")) return;
    const id = identity.current;
    intentionalSignOut.current = true;
    const result = await browserClient()?.auth.signOut({ scope: "local" });
    if (result?.error) setError("Sign-out failed. Try again when connected.");
    if (!result?.error && id) {
      try { storage()?.removeItem(accountKey(id)); } catch { /* best effort */ }
      try { storage()?.removeItem(lastAccountKey); } catch { /* best effort */ }
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("debtpilot-accounts");
        channel.postMessage({ type: "signout", id }); channel.close();
      }
    }
    intentionalSignOut.current = false;
  }, []);

  useEffect(() => {
    const local = readLocalData(storage());
    guest.current = local.data; blocked.current = local.blocked;
    // Initial browser hydration is deliberately performed once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrent(local.data); setSavingBlocked(local.blocked); setError(local.error);
    setStatus(local.error ? "unsynced" : "saved");
    if (!accountsEnabled) { setReady(true); return; }
    let mounted = true;
    const auth = browserClient();
    if (!auth) { setError("Account storage is not configured. Your browser data remains available."); setReady(true); return; }
    const lock = lockAccount;
    const initialize = async (id: string | null) => {
      if (!mounted) return;
      const initialization = ++generation.current;
      if (timer.current) clearTimeout(timer.current);
      identity.current = id; setAccountId(id); setChoice(null); setUnavailable(false); paused.current = false; loadFailed.current = false;
      if (!id) {
        revision.current = null; dirty.current = false;
        const guestData = readLocalData(storage());
        guest.current = guestData.data; blocked.current = guestData.blocked;
        setCurrent(guestData.data); setSavingBlocked(guestData.blocked); setError(guestData.error);
        setStatus(guestData.error ? "unsynced" : "saved"); setReady(true); return;
      }
      try { storage()?.setItem(lastAccountKey, id); } catch { /* Session still works without a hint. */ }
      blocked.current = false; setSavingBlocked(false);
      setReady(false); setStatus("loading"); setCurrent(initialData());
      const cached = readPending(id);
      const cloud = await loadPlan();
      if (!mounted || identity.current !== id || generation.current !== initialization) return;
      if (cloud.error === "auth") { lock(); return; }
      if (cloud.error) {
        loadFailed.current = true;
        if (cached) { revision.current = cached.revision; dirty.current = cached.dirty; setCurrent(cached.data); }
        else { paused.current = true; setUnavailable(true); }
        setStatus("unsynced"); setError("Cloud data could not be loaded. Retry when connected."); setReady(true); return;
      }
      if (cached?.dirty) {
        revision.current = cached.revision; dirty.current = true; setCurrent(cached.data);
        const disposition = pendingDisposition(cached, cloud.plan);
        if (disposition === "acknowledged" && cloud.plan) {
          revision.current = cloud.plan.revision; dirty.current = false;
          writePending(id, { data: cloud.plan.data, revision: cloud.plan.revision, dirty: false, mutationId: null }); setStatus("saved");
        } else if (disposition === "conflict") {
          paused.current = true; setChoice({ browser: cached.data, cloud: cloud.plan, fromCache: true }); setStatus("conflict");
        } else { setStatus("unsynced"); timer.current = setTimeout(() => { void flush(); }, 750); }
      } else if (changed(guest.current) && !ignoredGuest(id, guest.current)) {
        paused.current = true; setChoice({ browser: guest.current, cloud: cloud.plan, fromCache: false }); setStatus("conflict");
      } else if (cloud.plan) {
        revision.current = cloud.plan.revision; dirty.current = false; setCurrent(cloud.plan.data);
        writePending(id, { data: cloud.plan.data, revision: cloud.plan.revision, dirty: false, mutationId: null }); setStatus("saved");
      } else {
        paused.current = true; setChoice({ browser: guest.current, cloud: null, fromCache: false }); setStatus("conflict");
      }
      setError(null); setReady(true);
    };
    void auth.auth.getUser().then(async (result: { data: { user: User | null }; error: unknown }) => {
      if (result.data.user?.email_confirmed_at) { void initialize(result.data.user.id); return; }
      if (result.error) {
        const fallback = await auth.auth.getSession();
        const session = fallback.data.session;
        if (session?.user.email_confirmed_at && session.expires_at && session.expires_at > Date.now() / 1000) { void initialize(session.user.id); return; }
        if (hasLastAccount()) { lock(); return; }
      }
      void initialize(null);
    });
    const listener = auth.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      const id = session?.user.email_confirmed_at ? session.user.id : null;
      const explicit = intentionalSignOut.current;
      if (id !== identity.current) setTimeout(() => {
        if (!id && !explicit && hasLastAccount()) lock();
        else void initialize(id);
      }, 0);
    });
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("debtpilot-accounts");
    if (channel) channel.onmessage = (message: MessageEvent<{ type: string; id: string }>) => {
      if (message.data.type === "signout" && message.data.id === identity.current) void initialize(null);
    };
    const online = () => {
      if (identity.current && (paused.current || (loadFailed.current && !dirty.current))) void initialize(identity.current);
      else if (identity.current && dirty.current) void flush();
    };
    window.addEventListener("online", online);
    const focus = async () => {
      const id = identity.current;
      if (!id || dirty.current || paused.current) return;
      const remote = await loadPlan();
      if (!mounted || identity.current !== id || dirty.current || paused.current) return;
      if (remote.error === "auth") { lock(); return; }
      if (remote.plan) {
        revision.current = remote.plan.revision; setCurrent(remote.plan.data); setStatus("saved");
        writePending(id, { data: remote.plan.data, revision: remote.plan.revision, dirty: false, mutationId: null });
      }
    };
    window.addEventListener("focus", focus);
    return () => { mounted = false; listener.data.subscription.unsubscribe(); channel?.close(); window.removeEventListener("online", online); window.removeEventListener("focus", focus); if (timer.current) clearTimeout(timer.current); };
  }, [flush, lockAccount, setCurrent]);

  const download = () => downloadJson(createBackup(choice?.browser ?? current.current), `debtpilot-backup-${new Date().toISOString().slice(0, 10)}.json`);
  const retry = async (): Promise<SaveResult> => {
    if (identity.current && loadFailed.current && !dirty.current) { window.location.reload(); return { ok: false, reason: "network" }; }
    return flush();
  };
  return <Context.Provider value={{ data, ready, error, status, accountId, choice, update, commit, flush, retry, choose, signOut, download }}>
    {ready && accountId && !choice && <p role="status" className="mx-auto max-w-5xl px-5 pt-2 text-sm text-ink-soft">{status === "saved" ? "Saved to your account" : status === "saving" ? "Saving to your account…" : status === "unsynced" ? "Changes waiting to sync" : "Review plan conflict"}</p>}
    {ready && choice && <aside role="dialog" aria-label="Choose saved plan" className="mx-auto max-w-5xl rounded-2xl bg-paper p-5">
      <p className="font-semibold">Choose a plan for this account</p>
      <p className="mt-2 text-sm">This browser has {choice.browser.profile.debts.length} debts and {choice.browser.checkIns.snapshots.length} check-ins. {choice.cloud ? `The cloud plan has ${choice.cloud.data.profile.debts.length} debts and ${choice.cloud.data.checkIns.snapshots.length} check-ins.` : "No cloud plan exists yet."} Export before replacing either version.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {choice.cloud && <button className="secondary-button px-4" onClick={() => { void choose("cloud"); }}>Use cloud plan</button>}
        <button className="primary-button px-4" onClick={() => { if (window.confirm("Replace the cloud plan with this browser’s plan and check-ins? Imported guest data will be removed after the upload succeeds.")) void choose("browser"); }}>Upload browser plan</button>
        {!choice.cloud && <button className="secondary-button px-4" onClick={() => { void choose("empty"); }}>Start empty cloud plan</button>}
        <button className="secondary-button px-4" onClick={download}>Download browser backup</button>
      </div>
    </aside>}
    {ready && error && <aside role="alert" className="mx-auto max-w-5xl rounded-2xl bg-coral-soft p-4 text-sm">
      <p>{error}</p><div className="mt-3 flex flex-wrap gap-3">
        {!savingBlocked && <button className="secondary-button px-4" onClick={() => { if (paused.current && !choice) window.location.reload(); else void retry(); }}>Retry saving</button>}
        {accountId && <button className="secondary-button px-4" onClick={download}>Download backup</button>}
      </div>
    </aside>}
    {(pathname.startsWith("/account") || (!choice && !unavailable)) && children}
  </Context.Provider>;
}

export function useLocalData() {
  const value = useContext(Context);
  if (!value) throw new Error("LocalDataProvider is required");
  return value;
}
