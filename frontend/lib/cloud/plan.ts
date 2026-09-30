import { isLocalData, type LocalData } from "../localData";

export type CloudPlan = { data: LocalData; revision: number; updatedAt: string; lastMutationId: string };
export type PendingPlan = { data: LocalData; revision: number | null; dirty: boolean; mutationId: string | null; acknowledged?: LocalData | null };
export type SaveResult = { ok: true } | { ok: false; reason: "storage" | "network" | "conflict" | "auth" | "too_large" };
export const MAX_CLOUD_BYTES = 1048576;
export const accountKey = (id: string) => `debtpilot.account.${id}.v1`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function documentsEqual(first: LocalData, second: LocalData) { return canonical(first) === canonical(second); }

export function pendingDisposition(pending: PendingPlan, cloud: CloudPlan | null): "acknowledged" | "retry" | "conflict" {
  if (cloud && pending.mutationId === cloud.lastMutationId && documentsEqual(pending.data, cloud.data)) return "acknowledged";
  return pending.revision === (cloud?.revision ?? null) ? "retry" : "conflict";
}

export function parseCloudPlan(value: unknown): CloudPlan | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (!isLocalData(row.data) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || typeof row.lastMutationId !== "string" || typeof row.updatedAt !== "string") return null;
  return row as CloudPlan;
}

export function readPending(id: string): PendingPlan | null {
  try {
    const raw = localStorage.getItem(accountKey(id));
    if (!raw) return null;
    const row: unknown = JSON.parse(raw);
    if (typeof row !== "object" || row === null) return null;
    const value = row as Record<string, unknown>;
    if (!isLocalData(value.data) || !(value.revision === null || (Number.isSafeInteger(value.revision) && Number(value.revision) > 0)) || typeof value.dirty !== "boolean" || !(value.mutationId === null || typeof value.mutationId === "string")) return null;
    if (value.acknowledged !== undefined && value.acknowledged !== null && !isLocalData(value.acknowledged)) return null;
    return value as PendingPlan;
  } catch { return null; }
}

export function writePending(id: string, pending: PendingPlan): boolean {
  try {
    const previous = readPending(id);
    const acknowledged = pending.acknowledged ?? (pending.dirty ? previous?.acknowledged ?? null : pending.data);
    localStorage.setItem(accountKey(id), JSON.stringify({ ...pending, acknowledged })); return true;
  }
  catch { return false; }
}

export async function loadPlan(): Promise<{ plan: CloudPlan | null; error: "auth" | "network" | null }> {
  try {
    const response = await fetch("/api/plan", { cache: "no-store" });
    if (response.status === 404) return { plan: null, error: null };
    if (response.status === 401) return { plan: null, error: "auth" };
    if (!response.ok) return { plan: null, error: "network" };
    const plan = parseCloudPlan(await response.json());
    return { plan, error: plan ? null : "network" };
  } catch { return { plan: null, error: "network" }; }
}

export async function savePlan(data: LocalData, revision: number | null, mutationId: string): Promise<{ plan: CloudPlan | null; error: "auth" | "network" | "conflict" | "too_large" | null }> {
  try {
    const response = await fetch("/api/plan", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data, expectedRevision: revision, mutationId }), cache: "no-store" });
    if (response.status === 409) return { plan: null, error: "conflict" };
    if (response.status === 401) return { plan: null, error: "auth" };
    if (response.status === 413) return { plan: null, error: "too_large" };
    if (!response.ok) return { plan: null, error: "network" };
    const plan = parseCloudPlan(await response.json());
    return { plan, error: plan ? null : "network" };
  } catch { return { plan: null, error: "network" }; }
}
