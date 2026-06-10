"use client";

import { useEffect, useRef } from "react";

export default function VideoPanel({
  localStream,
  remoteStream,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <div className="fade-in absolute inset-0 z-30 flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        {/* Remote (full screen) */}
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className="h-full w-full bg-abyss object-cover"
        />
        {/* Subtle vignette for cinematic depth */}
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_180px_60px_rgba(0,0,0,0.65)]" />

        {!remoteStream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-dim">
            <span className="live-dot" />
            <span className="mono text-xs uppercase tracking-[0.2em]">
              waiting for stranger&rsquo;s video…
            </span>
          </div>
        )}

        {/* Live badge */}
        <div className="glass mono absolute left-4 top-4 flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-ink">
          <span className="live-dot" />
          live · p2p
        </div>

        {/* Local picture-in-picture */}
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-5 right-5 h-44 w-32 rounded-xl border border-[var(--hairline-bright)] bg-abyss object-cover shadow-[0_10px_40px_-10px_rgba(0,0,0,0.9)]"
        />
      </div>

      <div className="flex justify-center bg-black/80 p-5 backdrop-blur">
        <button onClick={onEnd} className="btn-danger px-8 py-3 text-[15px]">
          End video
        </button>
      </div>
    </div>
  );
}
