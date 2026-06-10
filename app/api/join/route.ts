import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyPrivacyOffset, isValidLatLng } from "@/lib/geo";
import { hashSecret, isValidSecret, isValidSessionId, secretMatches } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — body { id, lat, lng, secret } (raw coords).
// Applies a 1–3 km privacy offset and upserts the presence row. Raw
// coordinates are never stored. The secret hash binds this id to its owner.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { id, lat, lng, secret } = (body ?? {}) as Record<string, unknown>;

  if (!isValidSessionId(id)) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  if (!isValidSecret(secret)) {
    return Response.json({ error: "invalid secret" }, { status: 400 });
  }
  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }

  // If the id already exists, only its original owner (matching secret) may
  // update it — otherwise anyone could hijack a known id's row.
  const existing = await prisma.presence.findUnique({
    where: { id },
    select: { secretHash: true },
  });
  if (existing && !secretMatches(secret, existing.secretHash)) {
    return Response.json({ error: "id taken" }, { status: 403 });
  }

  const offset = applyPrivacyOffset(lat as number, lng as number);
  const secretHash = hashSecret(secret);

  await prisma.presence.upsert({
    where: { id },
    create: {
      id,
      lat: offset.lat,
      lng: offset.lng,
      busy: false,
      lastSeen: new Date(),
      secretHash,
    },
    update: {
      lat: offset.lat,
      lng: offset.lng,
      lastSeen: new Date(),
    },
  });

  // Broadcast an arrival ripple to everyone's globe (only for genuinely new
  // sessions, not heartbeat re-joins). Best-effort — never fail a join over it.
  if (!existing) {
    try {
      await prisma.ripple.create({
        data: { kind: "join", lat: offset.lat, lng: offset.lng },
      });
    } catch {
      /* ambient nicety — ignore */
    }
  }

  return Response.json({ ok: true });
}
