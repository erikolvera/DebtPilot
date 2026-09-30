import { createBrowserClient } from "@supabase/ssr";
import { cloudConfig } from "./config";

let client: ReturnType<typeof createBrowserClient> | null = null;
export function browserClient() {
  const config = cloudConfig();
  if (!config) return null;
  client ??= createBrowserClient(config.url, config.key);
  return client;
}
