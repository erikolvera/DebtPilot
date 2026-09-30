import { describe, expect, it, vi } from "vitest";
import { initialData } from "../localData";
import { documentsEqual, loadPlan, parseCloudPlan, pendingDisposition, readPending, savePlan, writePending } from "./plan";

const sample = { data: initialData(), revision: 3, updatedAt: "2026-09-29T12:00:00Z", lastMutationId: "mutation" };

describe("cloud plan protocol", () => {
  it("compares documents independently of PostgreSQL JSONB key ordering", () => {
    const reordered = { checkIns: sample.data.checkIns, profile: sample.data.profile, version: 1 as const };
    expect(documentsEqual(sample.data, reordered)).toBe(true);
  });
  it("retains the acknowledged copy alongside an unsynced draft", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    try {
      expect(writePending("user", { data: sample.data, revision: 3, dirty: false, mutationId: null })).toBe(true);
      const draft = { ...sample.data, profile: { ...sample.data.profile, extra: "5.00" } };
      writePending("user", { data: draft, revision: 3, dirty: true, mutationId: null });
      expect(readPending("user")?.acknowledged).toEqual(sample.data);
      expect(readPending("user")?.data).toEqual(draft);
    } finally { vi.unstubAllGlobals(); }
  });
  it("recovers a committed save after a lost response or browser restart", () => {
    expect(pendingDisposition({ data: sample.data, revision: 2, dirty: true, mutationId: "mutation" }, sample)).toBe("acknowledged");
    expect(pendingDisposition({ data: sample.data, revision: null, dirty: true, mutationId: null }, null)).toBe("retry");
    expect(pendingDisposition({ data: sample.data, revision: 2, dirty: true, mutationId: "different" }, sample)).toBe("conflict");
  });
  it("rejects unsupported documents and numeric money", () => {
    expect(parseCloudPlan({ ...sample, data: { ...sample.data, version: 2 } })).toBeNull();
    expect(parseCloudPlan({ ...sample, data: { ...sample.data, profile: { ...sample.data.profile, extra: 1 } } })).toBeNull();
    expect(parseCloudPlan(sample)).toEqual(sample);
  });

  it("surfaces a revision conflict without accepting remote data", async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: 409, ok: false });
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(await savePlan(sample.data, 3, "mutation")).toEqual({ plan: null, error: "conflict" });
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ expectedRevision: 3, mutationId: "mutation", data: { version: 1 } });
    } finally { vi.unstubAllGlobals(); }
  });

  it("distinguishes no cloud plan from an authentication failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ status: 404 }).mockResolvedValueOnce({ status: 401 }));
    try {
      expect(await loadPlan()).toEqual({ plan: null, error: null });
      expect(await loadPlan()).toEqual({ plan: null, error: "auth" });
    } finally { vi.unstubAllGlobals(); }
  });
});
