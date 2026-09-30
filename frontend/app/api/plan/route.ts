import { type NextRequest } from "next/server";
import { isLocalData } from "@/lib/localData";
import { boundedJson, reply, sameOrigin, verifiedUser } from "@/lib/cloud/http";

export const dynamic = "force-dynamic";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowResult(row: Record<string, unknown>) {
  return {
    data: row.data,
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    lastMutationId: row.last_mutation_id,
  };
}

export async function GET() {
  const auth = await verifiedUser();
  if (!auth) return reply({ error: "Sign in and verify your email." }, 401);
  const { data, error } = await auth.client.from("plans").select("data,revision,updated_at,last_mutation_id").eq("user_id", auth.user.id).maybeSingle();
  if (error) return reply({ error: "Your plan could not be loaded." }, 503);
  if (!data) return reply({ error: "No cloud plan yet." }, 404);
  if (!isLocalData(data.data)) return reply({ error: "Unsupported saved plan. Export or contact support." }, 422);
  return reply(rowResult(data));
}

export async function PUT(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ error: "Invalid request origin." }, 403);
  const auth = await verifiedUser();
  if (!auth) return reply({ error: "Sign in and verify your email." }, 401);
  let body: unknown;
  try { body = await boundedJson(request, 1048576 + 4096); }
  catch (error) { return reply({ error: "Invalid or oversized plan." }, error instanceof Error && error.message === "too_large" ? 413 : 422); }
  if (!record(body) || !isLocalData(body.data) ||
      !(body.expectedRevision === null || (Number.isSafeInteger(body.expectedRevision) && Number(body.expectedRevision) > 0)) ||
      typeof body.mutationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.mutationId)) {
    return reply({ error: "Invalid plan or revision." }, 422);
  }
  const { data, error } = await auth.client.rpc("save_plan", {
    p_data: body.data,
    p_expected_revision: body.expectedRevision,
    p_mutation_id: body.mutationId,
  });
  if (error) {
    if (error.code === "23514" || error.code === "22001") return reply({ error: "Plan exceeds the cloud size limit." }, 413);
    if (error.code === "28000") return reply({ error: "Verify your email before saving." }, 401);
    return reply({ error: "Your plan could not be saved." }, 503);
  }
  if (!data || !data.user_id) return reply({ error: "Your cloud plan changed. Review both versions before replacing either." }, 409);
  return reply(rowResult(data));
}
