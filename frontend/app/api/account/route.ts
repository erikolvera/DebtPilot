import { createClient } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { boundedJson, reply, sameOrigin, verifiedUser } from "@/lib/cloud/http";
import { cloudConfig } from "@/lib/cloud/config";

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ error: "Invalid request origin." }, 403);
  const auth = await verifiedUser();
  if (!auth || !auth.user.email) return reply({ error: "Sign in first." }, 401);
  let body: unknown;
  try { body = await boundedJson(request, 4096); } catch { return reply({ error: "Invalid request." }, 422); }
  if (typeof body !== "object" || body === null ||
      (body as Record<string, unknown>).confirmation !== "DELETE" ||
      typeof (body as Record<string, unknown>).password !== "string") return reply({ error: "Confirmation and password required." }, 422);
  const password = (body as { password: string }).password;
  const config = cloudConfig();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!config || !secret) return reply({ error: "Account deletion is unavailable." }, 503);
  const { error: verifyError } = await auth.client.auth.signInWithPassword({ email: auth.user.email, password });
  if (verifyError) return reply({ error: "Password could not be confirmed." }, 403);
  const admin = createClient(config.url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.auth.admin.deleteUser(auth.user.id);
  if (error) return reply({ error: "Account deletion failed. Try again." }, 503);
  await auth.client.auth.signOut();
  return reply({ deleted: true });
}
