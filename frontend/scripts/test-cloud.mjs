import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const status = spawnSync("supabase", ["status", "-o", "env"], { cwd: "..", encoding: "utf8" });
if (status.status !== 0) throw new Error("Start local Supabase before running cloud integration tests.");
const env = Object.fromEntries(status.stdout.split("\n").map((line) => {
  const index = line.indexOf("=");
  if (index < 0) return ["", ""];
  return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")];
}));
const url = env.API_URL;
const publicKey = env.PUBLISHABLE_KEY || env.ANON_KEY;
const secret = env.SECRET_KEY || env.SERVICE_ROLE_KEY;
if (!url || !publicKey || !secret) throw new Error("Local Supabase URL or test keys are missing.");
const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const users = [];
const plan = (amount) => ({ version: 1,
  profile: { incomes: [{ id: "income", name: "Pay", amount, frequency: "monthly" }], expenses: [], debts: [], extra: "0.00", preferredStrategy: null },
  checkIns: { baseline: null, snapshots: [], activeCommitment: null, dismissedPromptMonth: null, celebratedMilestones: [], celebratedPaidOffDebtIds: [] },
});
try {
  for (let i = 0; i < 2; i++) {
    const email = `cloud-test-${randomUUID()}@example.test`;
    const password = `local-test-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error);
    users.push(created.data.user.id);
    const client = createClient(url, publicKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    assert.ifError(signedIn.error);
    users[i] = { id: users[i], client };
  }
  const [a, b] = users;
  const first = await a.client.rpc("save_plan", { p_data: plan("1000.00"), p_expected_revision: null, p_mutation_id: randomUUID() });
  assert.ifError(first.error);
  assert.equal(first.data.revision, 1);
  const numericMoney = await a.client.rpc("save_plan", { p_data: plan(1000), p_expected_revision: 1, p_mutation_id: randomUUID() });
  assert.equal(numericMoney.error?.code, "23514", "The database must reject numeric money even through direct RPC calls.");
  const second = await b.client.rpc("save_plan", { p_data: plan("2000.00"), p_expected_revision: null, p_mutation_id: randomUUID() });
  assert.ifError(second.error);
  const unseen = await a.client.from("plans").select("user_id").eq("user_id", b.id);
  assert.ifError(unseen.error);
  assert.equal(unseen.data.length, 0);
  const stolen = await a.client.from("plans").update({ data: plan("1.00") }).eq("user_id", b.id);
  assert.ok(stolen.error, "Direct writes must be revoked, even for owners.");
  const updated = await a.client.rpc("save_plan", { p_data: plan("1100.00"), p_expected_revision: 1, p_mutation_id: randomUUID() });
  assert.ifError(updated.error);
  assert.equal(updated.data.revision, 2);
  const stale = await a.client.rpc("save_plan", { p_data: plan("1200.00"), p_expected_revision: 1, p_mutation_id: randomUUID() });
  assert.ifError(stale.error);
  assert.equal(stale.data.user_id, null);
  const observed = await a.client.from("plans").select("data,revision").single();
  assert.ifError(observed.error);
  assert.equal(observed.data.data.profile.incomes[0].amount, "1100.00");
  assert.equal(observed.data.revision, 2);
  const raced = await Promise.all(["1300.00", "1400.00"].map((amount) => a.client.rpc("save_plan", { p_data: plan(amount), p_expected_revision: 2, p_mutation_id: randomUUID() })));
  raced.forEach((value) => assert.ifError(value.error));
  assert.equal(raced.filter((value) => value.data.user_id !== null).length, 1, "Only one simultaneous write may commit.");
  const huge = plan("1500.00");
  huge.profile.incomes[0].name = "x".repeat(1048576);
  const oversized = await a.client.rpc("save_plan", { p_data: huge, p_expected_revision: 3, p_mutation_id: randomUUID() });
  assert.equal(oversized.error?.code, "23514");
  const deleted = await admin.auth.admin.deleteUser(a.id);
  assert.ifError(deleted.error);
  const afterDelete = await a.client.rpc("save_plan", { p_data: plan("9999.00"), p_expected_revision: null, p_mutation_id: randomUUID() });
  assert.ok(afterDelete.error, "A deleted identity cannot recreate its plan.");
  const residual = await admin.from("plans").select("user_id").eq("user_id", a.id);
  assert.ifError(residual.error);
  assert.equal(residual.data.length, 0);
  console.log("Cloud integration: isolation, revision conflict, money strings, and deletion passed.");
} finally {
  for (const user of users) if (user?.id) await admin.auth.admin.deleteUser(user.id);
}
