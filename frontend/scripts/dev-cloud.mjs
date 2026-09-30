import { spawn, spawnSync } from "node:child_process";

const status = spawnSync("supabase", ["status", "-o", "env"], { cwd: "..", encoding: "utf8" });
if (status.status !== 0) throw new Error("Start local Supabase before running cloud development mode.");
const values = Object.fromEntries(status.stdout.split("\n").map((line) => {
  const position = line.indexOf("=");
  return position < 0 ? ["", ""] : [line.slice(0, position), line.slice(position + 1).replace(/^"|"$/g, "")];
}));
const child = spawn("npm", ["run", "dev"], {
  env: {
    ...process.env,
    NEXT_PUBLIC_CLOUD_ACCOUNTS: "true",
    NEXT_PUBLIC_SUPABASE_URL: values.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY || values.ANON_KEY,
    SUPABASE_SECRET_KEY: values.SECRET_KEY || values.SERVICE_ROLE_KEY,
  },
  stdio: "inherit",
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
