"use client";

import { useEffect, useRef, useState } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import { join, leave, poll, sendSignal } from "@/lib/api";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import { type PeerDot, type SignalMsg, type RippleEvent } from "@/lib/types";
import { haversineKm, formatDistance } from "@/lib/geo";

// One-line caption for the live activity ticker.
function rippleText(r: RippleEvent): string {
  if (r.kind === "join") return "a soul tuned in";
  if (r.lat2 != null && r.lng2 != null) {
    const km = haversineKm(r.lat, r.lng, r.lat2, r.lng2);
    const apart =
      km < 1
        ? "moments apart"
        : `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString()} km apart`;
    return `two souls connected · ${apart}`;
  }
  return "two souls connected";
}

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

const REQUEST_TIMEOUT_MS = 30_000;

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  const [sessionId] = useState(() => crypto.randomUUID());
  // High-entropy per-session secret. The id is broadcast to everyone; this is
  // never sent to other clients and proves we own the session on the server.
  const [secret] = useState(
    () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ""),
  );
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  // Phase 4 — Global Ripples: the latest batch of unseen ambient events fed to
  // the map, plus a short-lived activity ticker.
  const [rippleBatch, setRippleBatch] = useState<RippleEvent[]>([]);
  const seenRipples = useRef<Set<string>>(new Set());
  const [activity, setActivity] = useState<{ id: string; text: string }[]>([]);

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
  };

  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  function teardown(message?: string) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setMessages([]);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  function startPeer(peerId: string, initiator: boolean) {
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void sendSignal(sessionId, peerId, type, secret, payload);
      },
      onChat: (text) => addMessage(false, text),
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        if (state === "failed") {
          teardown("Connection failed (network).");
        }
      },
      onChannelOpen: () => {
        setConn({ kind: "connected", peerId });
      },
    });
    peerRef.current = ps;
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming");
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          ps.startVideo()
            .then((stream) => {
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    setConn({ kind: "requesting", peerId });
    void sendSignal(sessionId, peerId, "request", secret);
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void sendSignal(sessionId, peerId, "end", secret);
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void sendSignal(sessionId, connRef.current.peerId, "end", secret);
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    void sendSignal(sessionId, peerId, "accept", secret);
    setConn({ kind: "connecting", peerId });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void sendSignal(sessionId, connRef.current.peerId, "decline", secret);
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void sendSignal(sessionId, c.peerId, "end", secret);
    }
    teardown();
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return;
    setVideo("requesting");
    peerRef.current.sendControl("video-request");
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps) return;
    ps.startVideo()
      .then((stream) => {
        setLocalStream(stream);
        ps.sendControl("video-accept");
        setVideo("active");
      })
      .catch(() => {
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    peerRef.current?.sendControl("video-decline");
    setVideo("none");
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          void sendSignal(sessionId, sig.fromId, "decline", secret);
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          teardown("Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerRef.current && peerId === sig.fromId) {
          void peerRef.current.handleSignal(
            sig.type as DescType,
            sig.payload ?? "",
          );
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (
          (c.kind === "incoming" ||
            c.kind === "connecting" ||
            c.kind === "connected") &&
          c.peerId === sig.fromId
        ) {
          if (c.kind === "incoming") setConn({ kind: "idle" });
          else teardown("Stranger disconnected.");
        }
        break;
      }
    }
  }

  const processSignalRef = useRef(processSignal);
  useEffect(() => {
    processSignalRef.current = processSignal;
  });

  useEffect(() => {
    if (phase !== "live" || !sessionId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await poll(sessionId, secret);
        if (!active) return;
        setPeers(data.peers);
        for (const s of data.signals) processSignalRef.current(s);

        // Global Ripples: animate only events we haven't seen before.
        const fresh = (data.ripples ?? []).filter(
          (r) => !seenRipples.current.has(r.id),
        );
        if (fresh.length > 0) {
          for (const r of fresh) seenRipples.current.add(r.id);
          if (seenRipples.current.size > 300) {
            seenRipples.current = new Set(fresh.map((r) => r.id));
          }
          setRippleBatch(fresh);
          setActivity((prev) =>
            [...fresh.map((r) => ({ id: r.id, text: rippleText(r) })), ...prev].slice(
              0,
              5,
            ),
          );
          for (const r of fresh) {
            window.setTimeout(() => {
              if (active) setActivity((prev) => prev.filter((a) => a.id !== r.id));
            }, 6000);
          }
        }
      } catch {}
      if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, sessionId, secret]);

  useEffect(() => {
    if (!sessionId || phase !== "live") return;
    const onLeave = () => {
      // Tell any active/pending peer we're gone so their chat ends immediately,
      // instead of waiting for WebRTC to slowly time out. sendBeacon survives
      // the tab closing.
      const c = connRef.current;
      const peerId =
        c.kind === "requesting" ||
        c.kind === "incoming" ||
        c.kind === "connecting" ||
        c.kind === "connected"
          ? c.peerId
          : null;
      if (peerId && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/signal",
          JSON.stringify({
            fromId: sessionId,
            toId: peerId,
            type: "end",
            secret,
          }),
        );
      }
      leave(sessionId, secret);
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [sessionId, phase, secret]);

  async function handleReady(lat: number, lng: number) {
    setMyLocation({ lat, lng });
    await join(sessionId, lat, lng, secret);
    setPhase("live");
  }

  if (phase === "gate") {
    return <EntryGate onReady={handleReady} />;
  }

  const inChat = conn.kind === "connecting" || conn.kind === "connected";

  // The peer we're currently engaged with (drives the connection beam + chat
  // distance readout).
  const activePeerId =
    conn.kind === "requesting" ||
    conn.kind === "incoming" ||
    conn.kind === "connecting" ||
    conn.kind === "connected"
      ? conn.peerId
      : null;
  const activePeer = activePeerId
    ? peers.find((p) => p.id === activePeerId)
    : undefined;
  const distanceLabel =
    myLocation && activePeer
      ? formatDistance(
          haversineKm(
            myLocation.lat,
            myLocation.lng,
            activePeer.lat,
            activePeer.lng,
          ),
        )
      : null;

  return (
    <main className="fixed inset-0 overflow-hidden text-ink">
      <WorldMap
        peers={peers}
        me={myLocation}
        onPeerClick={requestConnection}
        canConnect={conn.kind === "idle"}
        activePeerId={activePeerId}
        rippleBatch={rippleBatch}
      />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between p-4">
        <div className="glass mono flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs">
          <span className="font-semibold tracking-[0.28em] text-cyan">
            PULSE
          </span>
        </div>
        <div className="glass mono flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-ink-dim">
          <span className="live-dot" />
          <span className="text-cyan">{peers.length}</span>{" "}
          {peers.length === 1 ? "soul" : "souls"} online
        </div>
      </div>

      {/* Live activity ticker — Global Ripples */}
      {activity.length > 0 && (
        <div className="pointer-events-none absolute bottom-5 left-4 z-30 flex max-w-xs flex-col gap-1.5">
          {activity.map((a) => (
            <div
              key={a.id}
              className="ticker-item glass mono flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] text-ink-dim"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan shadow-[0_0_6px_var(--cyan)]" />
              {a.text}
            </div>
          ))}
        </div>
      )}

      {notice && (
        <div className="glass-strong mono fade-in absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-sm text-ink shadow-lg">
          {notice}
        </div>
      )}

      {conn.kind === "requesting" && (
        <div className="glass-strong fade-in absolute left-1/2 top-20 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-sm text-ink shadow-lg">
          <span className="flex items-center gap-2">
            <span className="live-dot" />
            Pinging stranger…
          </span>
          <button
            onClick={cancelRequest}
            className="btn-ghost px-3 py-1 text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      {conn.kind === "incoming" && (
        <ConnectionPrompt
          title="A stranger wants to connect"
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      {inChat && (
        <ChatPanel
          messages={messages}
          connected={conn.kind === "connected"}
          videoBusy={video !== "none"}
          distanceLabel={distanceLabel}
          onSend={(text) => {
            peerRef.current?.sendChat(text);
            addMessage(true, text);
          }}
          onStartVideo={startVideoRequest}
          onEnd={endConnection}
        />
      )}

      {video === "requesting" && (
        <div className="glass-strong mono fade-in absolute bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-sm text-ink shadow-lg">
          <span className="live-dot" />
          Waiting for stranger to accept video…
        </div>
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          title="Start video call?"
          subtitle="The stranger wants to turn on video."
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          onEnd={endVideo}
        />
      )}
    </main>
  );
}
