import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidSessionId, secretMatches } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { id, secret }. Removes the caller's presence row and
// drains their inbox. Called via navigator.sendBeacon on tab close, so the body
// may arrive as text — parse defensively. Requires the session secret so a
// known (public) id can't be used to kick someone else off the map.
export async function POST(request: NextRequest) {
  let id: unknown;
  let secret: unknown;
  try {
    const text = await request.text();
    const parsed = text ? JSON.parse(text) : {};
    id = parsed?.id;
    secret = parsed?.secret;
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  if (!isValidSessionId(id) || typeof secret !== "string") {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const self = await prisma.presence.findUnique({
    where: { id },
    select: { secretHash: true },
  });

  // No row, or wrong secret → no-op (don't reveal existence, don't delete).
  if (!self || !secretMatches(secret, self.secretHash)) {
    return Response.json({ ok: true });
  }

  // Drain only OUR inbox (toId == me). Outgoing signals (incl. the farewell
  // "end") are left for delivery and reaped later by SIGNAL_TTL_MS.
  await prisma.signal.deleteMany({ where: { toId: id } });
  await prisma.presence.deleteMany({ where: { id } });

  return Response.json({ ok: true });
}
