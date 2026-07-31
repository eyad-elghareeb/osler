import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { CloudSession } from "@/lib/osler/cloud";

const COOKIE_NAME = "osler-session";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { session?: CloudSession; username?: string };
    const session = body.session;
    const username = body.username || session?.user?.displayName || session?.user?.username;

    if (!username && !session) {
      return NextResponse.json({ error: "Invalid session payload" }, { status: 400 });
    }

    const payload = JSON.stringify(session ? session : { username });
    const expiresAt = session?.expiresAt ? new Date(session.expiresAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, payload, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to set session cookie" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(COOKIE_NAME);

    if (!cookie?.value) {
      return NextResponse.json({ session: null }, { status: 200 });
    }

    const data = JSON.parse(cookie.value);
    // If it's a CloudSession, check expiry
    if (data && typeof data === "object" && "expiresAt" in data) {
      if (data.expiresAt <= Date.now()) {
        const store = await cookies();
        store.delete(COOKIE_NAME);
        return NextResponse.json({ session: null }, { status: 200 });
      }
    }

    return NextResponse.json({ session: data }, { status: 200 });
  } catch {
    return NextResponse.json({ session: null }, { status: 200 });
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(COOKIE_NAME);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete session cookie" }, { status: 500 });
  }
}
