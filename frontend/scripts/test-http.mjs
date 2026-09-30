import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const result = spawnSync("supabase", ["status", "-o", "env"], { cwd: "..", encoding: "utf8" });
if (result.status !== 0) throw new Error("Start local Supabase before HTTP tests.");
const env = Object.fromEntries(result.stdout.split("\n").map((line) => {
  const at = line.indexOf("=");
  return at < 0 ? ["", ""] : [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, "")];
}));
const url = env.API_URL;
const publicKey = env.PUBLISHABLE_KEY || env.ANON_KEY;
const secret = env.SECRET_KEY || env.SERVICE_ROLE_KEY;
if (!url || !publicKey || !secret) throw new Error("Local Supabase status is incomplete.");
const origin = "http://127.0.0.1:3005";
const server = spawn("node", ["node_modules/next/dist/bin/next", "dev", "--webpack", "-p", "3005"], {
  env: { ...process.env, NEXT_PUBLIC_CLOUD_ACCOUNTS: "true", NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SECRET_KEY: secret, NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8000" },
  stdio: ["ignore", "ignore", "pipe"],
});
let serverError = "";
server.stderr.on("data", (chunk) => { serverError += chunk.toString(); });
const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
let userId = null;
const data = { version: 1,
  profile: { incomes: [], expenses: [], debts: [], extra: "0.00", preferredStrategy: null },
  checkIns: { baseline: null, snapshots: [], activeCommitment: null, dismissedPromptMonth: null, celebratedMilestones: [], celebratedPaidOffDebtIds: [] },
};
try {
  let available = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) break;
    try { const page = await fetch(`${origin}/account`); if (page.ok) { available = true; break; } } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(available, `Next.js account page did not start: ${serverError.slice(0, 500)}`);
  const email = `http-test-${randomUUID()}@example.test`;
  const password = `local-test-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  userId = created.data.user.id;
  const cookies = new Map();
  const client = createServerClient(url, publicKey, { cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach(({ name, value }) => cookies.set(name, value)),
  } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  const request = (method, body, extra = {}) => fetch(`${origin}/api/plan`, {
    method, headers: { Origin: origin, Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "), ...(body ? { "Content-Type": "application/json" } : {}), ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal((await fetch(`${origin}/api/plan`)).status, 401);
  assert.equal((await request("GET")).status, 404);
  assert.equal((await request("PUT", { data, expectedRevision: null, mutationId: randomUUID() }, { Origin: "https://untrusted.invalid" })).status, 403);
  const saved = await request("PUT", { data, expectedRevision: null, mutationId: randomUUID() });
  const savedText = await saved.text();
  assert.equal(saved.status, 200, `create failed: ${savedText}`);
  assert.equal(JSON.parse(savedText).revision, 1);
  const loaded = await request("GET");
  assert.equal(loaded.status, 200);
  assert.equal((await loaded.json()).data.profile.extra, "0.00");
  assert.equal((await request("PUT", { data, expectedRevision: 1, mutationId: randomUUID() })).status, 200);
  assert.equal((await request("PUT", { data, expectedRevision: 1, mutationId: randomUUID() })).status, 409);
  assert.equal((await request("PUT", { data: { ...data, version: 2 }, expectedRevision: 2, mutationId: randomUUID() })).status, 422);
  const huge = { ...data, profile: { ...data.profile, extra: "x".repeat(1048576 + 4096) } };
  assert.equal((await request("PUT", { data: huge, expectedRevision: 2, mutationId: randomUUID() })).status, 413);
  const refused = await fetch(`${origin}/api/account`, { method: "DELETE", headers: { Origin: origin, Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "), "Content-Type": "application/json" }, body: JSON.stringify({ password: "incorrect-password", confirmation: "DELETE" }) });
  assert.equal(refused.status, 403);
  const removed = await fetch(`${origin}/api/account`, { method: "DELETE", headers: { Origin: origin, Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "), "Content-Type": "application/json" }, body: JSON.stringify({ password, confirmation: "DELETE" }) });
  assert.equal(removed.status, 200, `delete failed: ${await removed.text()}`);
  const residual = await admin.from("plans").select("user_id").eq("user_id", userId);
  assert.ifError(residual.error);
  assert.equal(residual.data.length, 0);
  console.log("HTTP integration: authentication, CSRF, create/load/conflict, validation, and deletion passed.");
} finally {
  server.kill("SIGTERM");
  if (userId) await admin.auth.admin.deleteUser(userId);
}
