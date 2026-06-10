import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence";
import type { PollResponse } from "@/lib/types";
import { isValidSessionId, secretMatches } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/poll?id=  (secret via `x-pulse-secret` header)
// Drives the live map: (1) heartbeats + drains the mailbox of an AUTHENTICATED
// caller, (2) reaps stale presence + orphan signals, (3) returns online peers.
//
// A caller with no/invalid secret (e.g. the entry-screen "souls online" probe)
// still gets the public peer list, but never a heartbeat or a mailbox drain —
// so no one can drain a victim's inbox just by knowing their (public) id.
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const secret = request.headers.get("x-pulse-secret");

  if (!isValidSessionId(id)) {
    return Response.json({ error: "missing id" }, { status: 400 });
  }

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);

  // Authenticate the caller against their own presence row (if any).
  const self = await prisma.presence.findUnique({
    where: { id },
    select: { secretHash: true },
  });
  const authed = !!self && !!secret && secretMatches(secret, self.secretHash);

  // If a presence row exists but the secret is wrong/absent, refuse — don't let
  // a poll masquerade as someone else.
  if (self && !authed) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 1) Heartbeat — only for the authenticated owner of an existing row.
  if (authed) {
    await prisma.presence.updateMany({
      where: { id },
      data: { lastSeen: new Date(now) },
    });
  }

  // 2) Reap stale presence rows and orphaned signals.
  await prisma.presence.deleteMany({ where: { lastSeen: { lt: staleCutoff } } });
  await prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } });

  // 3) Online peers, excluding self.
  const peers = await prisma.presence.findMany({
    where: { id: { not: id }, lastSeen: { gte: staleCutoff } },
    select: { id: true, lat: true, lng: true, busy: true },
  });

  // 4) Drain the mailbox — only for the authenticated owner.
  let inbox: Awaited<ReturnType<typeof prisma.signal.findMany>> = [];
  if (authed) {
    inbox = await prisma.signal.findMany({
      where: { toId: id },
      orderBy: { createdAt: "asc" },
    });
    if (inbox.length > 0) {
      await prisma.signal.deleteMany({
        where: { id: { in: inbox.map((s) => s.id) } },
      });
    }
  }

  const response: PollResponse = {
    peers: peers.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, busy: p.busy })),
    signals: inbox.map((s) => ({
      id: s.id,
      fromId: s.fromId,
      toId: s.toId,
      type: s.type as PollResponse["signals"][number]["type"],
      payload: s.payload,
      createdAt: s.createdAt.toISOString(),
    })),
  };

  return Response.json(response);
}
