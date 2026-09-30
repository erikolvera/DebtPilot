import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cloudConfig } from "./config";

export async function serverClient() {
  const config = cloudConfig();
  if (!config) return null;
  const jar = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() { return jar.getAll(); },
      setAll(items) {
        try { items.forEach(({ name, value, options }) => jar.set(name, value, options)); }
        catch { /* Server Components cannot write cookies; proxy refreshes them. */ }
      },
    },
  });
}
