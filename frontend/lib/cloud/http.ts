import { NextResponse, type NextRequest } from "next/server";
import { serverClient } from "./server";

export const noStore = { "Cache-Control": "no-store" };
export function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && parsed.protocol === request.nextUrl.protocol;
  } catch { return false; }
}

export async function verifiedUser() {
  const client = await serverClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email_confirmed_at) return null;
  return { client, user: data.user };
}

export async function boundedJson(request: Request, maxBytes = 1048576): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new Error("too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error("too_large"); }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("invalid"); }
}
