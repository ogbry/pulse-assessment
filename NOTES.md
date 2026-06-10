# Pulse — Engineering Notes

Notes on what I changed in each phase, how I found the bugs, and where I made
trade-offs. The product is the same as the brief: anonymous, ephemeral,
peer-to-peer. I tried not to fight that.

The visual direction is a sonar/heartbeat theme I called "Living Signal": deep
blue-black, cyan and violet accents, Space Grotesk + JetBrains Mono, one shared
pulse rhythm, glass panels, a bit of film grain so the gradients don't look
flat. It respects `prefers-reduced-motion`.

## Phase 1 — Make it run

A few separate things were broken. I read the whole signal/data path first, then
checked each fix against the running API with curl and a two-window browser test.

| Bug | Symptom | Cause | Fix |
|---|---|---|---|
| Chat never arrived | Messages sent, nothing showed up | `sendChat` sent `{ t: "msg" }`, the receiver only accepted `{ t: "chat" }` | Use `"chat"` on both sides |
| Dead dots never left | Closed tabs stayed "online" forever | `poll` refreshed `lastSeen` on every row (`where: {}`), so everyone's poll kept everyone alive and stale reaping never ran | Heartbeat only the calling id |
| Stuck "busy" | Dots stayed greyed out after a normal hang-up | Only `decline` cleared `busy`, not `end` | Clear `busy` on `end` too |
| Peer not told on tab close | The other side's chat hung until WebRTC eventually timed out | `leave` removed the dot but never told the active peer | `sendBeacon` a final `end` to the peer on close |
| Farewell `end` could be dropped | (latent) the new `end` sometimes got deleted before delivery | `leave` also deleted signals where `fromId == me`, which nuked in-flight outgoing messages | `leave` now only drains our own inbox; outgoing signals are left to deliver and TTL-reap |

The chat tag mismatch was obvious once I read `webrtc.ts`. The README's "dots
stayed for ages" comment pointed me straight at presence reaping, and the
`where: {}` heartbeat was the culprit. The busy/notify gaps turned up when I ran
the connect → accept → leave sequence by hand.

## Phase 2 — Make it good

I wanted to avoid the obvious default look (dark theme, glass, emerald, a few
fade animations) since everyone reaching for an AI tool lands there. So I picked
one idea and committed to it. No animation library, just CSS and a small clock,
which kept it light.

The idea: Pulse is a sonar instrument.

- The map is a 3D globe (Mapbox globe projection) with atmosphere and stars,
  not a flat Mercator. It is, after all, supposed to be a globe of strangers.
- Every dot's sonar rings are locked to one shared clock, so the whole map
  pulses together instead of each dot doing its own thing. I do this with a
  negative `animation-delay` computed from a common epoch when each marker is
  created.
- Entry is a radar that sweeps and pings while it finds you, with a real "N
  souls online" count that reads the live network without registering you.
- Tapping a dot draws an animated great-circle arc to that peer. Hovering shows
  the actual distance.
- Chat, video, and the prompts share the same glass + mono styling.

Trade-off worth noting: the globe looks better than a flat map but it puts some
markers on the far side of the planet. Mapbox's globe occlusion fades those, and
it looked fine in testing, but it's something to watch. I kept the per-user dot
colors inside the cyan→violet range on purpose so the map reads as one thing.

## Phase 3 — Make it secure

I went through every route assuming the attacker is just another user of an app
that broadcasts session ids to everyone. Ranked, then fixed the top ones.

1. Critical: impersonation / broken access control. The session `id` was both the
   identity and the only credential, and `/api/poll` hands every id to every
   client. So anyone could take a known id and kick that user off the map via
   `/api/leave`, drain their inbox so they never receive connection requests or
   answers, or send `end`/`offer`/`ice` as them to break or hijack a call. I
   reproduced the kick and the spoof against the running server.

   Fix: each session generates a secret on the client. The server stores only
   its SHA-256 on the presence row and never returns it. `leave`, the
   `poll` heartbeat/drain, sending a signal as `fromId`, and overwriting an
   existing id on `join` all now require a constant-time match against that hash.
   I re-ran the attacks and they return 400/401/403, while the normal flow still
   works. Plain SHA-256 is fine here because the secret is a 128-bit random
   token, not a guessable password, so a slow KDF would only add latency.

2. High: clickjacking. The app asks for camera, mic, and geolocation, and there
   was nothing stopping it being framed to trick those grants. Added
   `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`, a `Permissions-Policy`
   that allows camera/mic/geo for self only, plus a Mapbox-compatible CSP, HSTS,
   nosniff, and a referrer policy. The CSP only allows `'unsafe-eval'` in dev
   (Turbopack needs it); production is stricter.

3. High: mailbox flooding. Nothing bounded how many signals you could pile into
   someone's inbox. Added a per-recipient cap (returns 429) and kept the existing
   64 KB payload limit.

4. Medium: loose validation. `fromId`/`toId` were unbounded strings and you could
   signal yourself. Bounded the id lengths and rejected `fromId == toId`.

5. Known gaps. Proper rate limiting needs a shared store like Upstash; per-instance
   memory is useless on serverless, so I documented it rather than shipping
   something that pretends to work. The inbox cap is a partial DB-backed
   mitigation. The full peer list is visible to any client, but that's how the
   product works, and now that ids aren't credentials it matters much less.
   Coordinates are still offset 1–3 km.

## Phase 4 — Make it better: Global Ripples

The map's weak spot is showing up to an empty world. Ripples fix that. When
anyone joins, a small ripple shows up on everyone's globe where they landed. When
two people connect, a bigger ripple fires at both their locations with a quick
arc between them, and a small ticker in the corner says what happened ("a soul
tuned in", "two souls connected · 9,558 km apart").

It fit the existing architecture: a short-lived `Ripple` table, written on join
and on accept, returned to every client through the poll they already make, and
reaped after a few seconds. The events carry the same offset coordinates the dots
use and no ids, so nothing new leaks. Writing a ripple is best-effort and wrapped
so it can never fail a join or a connection. The client only animates ripples it
hasn't seen, deduped by id.

The reason I picked this over a safety feature: it's the thing that makes Pulse
feel alive with two people instead of two hundred, and the name basically asks
for it.

If I had more time: throttle ripples in dense regions so they don't spam, add
"hotspots" that glow where activity clusters, maybe an optional audio ping on the
beat, and a real safety layer (consent before video, report/block) to go with the
liveness.

## Setup and deploy

Local: `npm install`, copy `.env.example` to `.env` with a pooled Neon
`DATABASE_URL` and a Mapbox `pk.` token, `npx prisma db push`, `npm run dev`.

Vercel: same two env vars. The schema is already on the shared Neon database, and
the build only runs `prisma generate`, so there's no migration step to run there.

Assumptions: the data is throwaway and anonymous, so resetting the dev DB is fine.
WebRTC is STUN-only per the brief, so a few strict networks won't connect media,
which I left alone.
