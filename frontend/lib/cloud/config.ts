export const accountsEnabled = process.env.NEXT_PUBLIC_CLOUD_ACCOUNTS === "true";

export function cloudConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!accountsEnabled) return null;
  if (!url || !key) throw new Error("Accounts are enabled but Supabase URL or publishable key is missing.");
  return { url, key };
}
