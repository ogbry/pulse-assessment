"use client";

import { useEffect, useRef, useState } from "react";

export default function EntryGate({
  onReady,
}: {
  onReady: (lat: number, lng: number) => void;
}) {
  const [status, setStatus] = useState<"idle" | "locating" | "error">("idle");
  const [error, setError] = useState<string>("");
  const [online, setOnline] = useState<number | null>(null);

  // Ambient liveness on the very first screen: peek at how many people are on
  // the map right now, without registering ourselves. poll() never creates a
  // presence row, so a throwaway id just reads the current count.
  useEffect(() => {
    let active = true;
    const probe = `probe-${crypto.randomUUID()}`;
    const read = async () => {
      try {
        const res = await fetch(`/api/poll?id=${probe}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (active) setOnline(Array.isArray(data.peers) ? data.peers.length : 0);
      } catch {
        /* ignore — count is a nicety, not load-bearing */
      }
    };
    read();
    const t = setInterval(read, 4000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("Your browser doesn't support location access.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => onReady(pos.coords.latitude, pos.coords.longitude),
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location is required to place you on the map. Enable it and tune in again."
            : "Couldn't read your location. Please try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  const scanning = status === "locating";

  return (
    <div className="aurora-field grain relative flex min-h-full flex-1 flex-col items-center justify-center gap-9 overflow-hidden p-6 text-ink">
      {/* Radar */}
      <div className="radar rise" aria-hidden>
        <div className="radar-ring" />
        <div className="radar-ring" />
        <div className="radar-ring" />
        <div className="radar-cross absolute inset-0" />
        <div className="radar-sweep" />
        <div className="radar-ping" />
        <div className="radar-core" />
      </div>

      {/* Wordmark + tagline */}
      <div className="rise text-center" style={{ animationDelay: "80ms" }}>
        <h1 className="wordmark text-6xl font-bold tracking-tight sm:text-7xl">
          Pulse
        </h1>
        <p className="mono mt-3 text-[11px] uppercase tracking-[0.34em] text-ink-dim">
          a living globe of strangers
        </p>
      </div>

      {/* Live count */}
      <div
        className="rise glass mono flex items-center gap-2 rounded-full px-4 py-1.5 text-xs text-ink-dim"
        style={{ animationDelay: "160ms" }}
      >
        <span className="live-dot" />
        {online === null ? (
          <span className="opacity-70">scanning the network…</span>
        ) : online === 0 ? (
          <span>
            <span className="text-ink">quiet right now</span> · be the first
            signal
          </span>
        ) : (
          <span>
            <span className="text-cyan">{online}</span>{" "}
            {online === 1 ? "soul" : "souls"} online now
          </span>
        )}
      </div>

      {/* CTA */}
      <button
        onClick={enter}
        disabled={scanning}
        className="btn-signal rise px-10 py-3.5 text-[15px]"
        style={{ animationDelay: "220ms" }}
      >
        {scanning ? "Acquiring signal…" : "Tune in"}
      </button>

      {status === "error" && (
        <p className="fade-in max-w-sm text-center text-sm text-magenta">
          {error}
        </p>
      )}

      <p
        className="rise mono absolute bottom-6 max-w-md px-4 text-center text-[10px] leading-relaxed tracking-wide text-ink-faint"
        style={{ animationDelay: "300ms" }}
      >
        No sign-up · your dot lands 1–3 km from you · peer-to-peer · nothing is
        stored — closing the tab ends everything
      </p>
    </div>
  );
}
