import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SignalType } from "@/lib/types";
import { isValidSessionId, secretMatches } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

const MAX_PAYLOAD = 64 * 1024; // SDP/ICE are small; cap to be safe.
const MAX_INBOX = 200; // anti-flood: cap pending messages per recipient.

// POST /api/signal — body { fromId, toId, type, payload?, secret }
// Drops one message into the recipient's mailbox, AS the authenticated sender.
// Also manages the `busy` flag so a user can only be in one connection at once.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { fromId, toId, type, payload, secret } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (!isValidSessionId(fromId) || !isValidSessionId(toId)) {
    return Response.json({ error: "invalid ids" }, { status: 400 });
  }
  if (fromId === toId) {
    return Response.json({ error: "cannot signal self" }, { status: 400 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  if (typeof secret !== "string") {
    return Response.json({ error: "invalid secret" }, { status: 400 });
  }
  if (
    payload !== undefined &&
    payload !== null &&
    (typeof payload !== "string" || payload.length > MAX_PAYLOAD)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  // Authenticate: the caller must own `fromId` (its secret must match a present
  // session). This blocks spoofing signals "from" someone else.
  const sender = await prisma.presence.findUnique({
    where: { id: fromId },
    select: { secretHash: true },
  });
  if (!sender || !secretMatches(secret, sender.secretHash)) {
    return Response.json({ error: "unauthorized" }, { status: 403 });
  }

  const signalType = type as SignalType;
  const payloadStr = typeof payload === "string" ? payload : null;

  // Anti-flood: refuse to grow a recipient's mailbox without bound.
  const pending = await prisma.signal.count({ where: { toId } });
  if (pending >= MAX_INBOX) {
    return Response.json({ error: "recipient mailbox full" }, { status: 429 });
  }

  // Enforce "one active connection at a time": if the target is busy or gone,
  // auto-decline instead of delivering the request.
  if (signalType === "request") {
    const target = await prisma.presence.findUnique({
      where: { id: toId },
      select: { busy: true },
    });
    if (!target || target.busy) {
      await sendDecline(toId, fromId);
      return Response.json({ ok: true, autoDeclined: true });
    }
  }

  // Busy transitions: accept → both busy; decline/end → free both.
  if (signalType === "accept") {
    await prisma.presence.updateMany({
      where: { id: { in: [fromId, toId] } },
      data: { busy: true },
    });
  } else if (signalType === "decline" || signalType === "end") {
    await prisma.presence.updateMany({
      where: { id: { in: [fromId, toId] } },
      data: { busy: false },
    });
  }

  await prisma.signal.create({
    data: { fromId, toId, type: signalType, payload: payloadStr },
  });

  return Response.json({ ok: true });
}

// Server-originated auto-decline from `target` back to `initiator`.
async function sendDecline(targetId: string, initiatorId: string) {
  await prisma.signal.create({
    data: { fromId: targetId, toId: initiatorId, type: "decline", payload: null },
  });
}
