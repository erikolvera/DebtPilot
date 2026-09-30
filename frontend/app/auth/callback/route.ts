import { NextResponse, type NextRequest } from "next/server";
import { serverClient } from "@/lib/cloud/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const type = request.nextUrl.searchParams.get("type");
  const destination = type === "recovery" ? "/account/reset" : "/account";
  const client = await serverClient();
  if (!code || !client) return NextResponse.redirect(new URL("/account?error=link", request.url));
  const { error } = await client.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? "/account?error=link" : destination, request.url));
}
