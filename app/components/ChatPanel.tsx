"use client";

import { useEffect, useRef, useState } from "react";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
}

export default function ChatPanel({
  messages,
  connected,
  videoBusy,
  distanceLabel,
  onSend,
  onStartVideo,
  onEnd,
}: {
  messages: ChatMessage[];
  connected: boolean;
  videoBusy: boolean;
  distanceLabel?: string | null;
  onSend: (text: string) => void;
  onStartVideo: () => void;
  onEnd: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
  }

  return (
    <div className="glass-strong absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col rounded-l-2xl text-ink rise">
      {/* Transmission header */}
      <header className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              className={`h-2 w-2 rounded-full ${
                connected
                  ? "bg-cyan shadow-[0_0_8px_var(--cyan)]"
                  : "bg-[var(--amber)] animate-pulse"
              }`}
            />
            Stranger
          </p>
          <p className="mono mt-1 truncate text-[10px] uppercase tracking-[0.18em] text-ink-dim">
            {connected ? "secure link" : "establishing link…"}
            {connected && distanceLabel ? ` · ${distanceLabel}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={onStartVideo}
            disabled={!connected || videoBusy}
            className="btn-ghost px-3.5 py-1.5 text-sm"
          >
            Video
          </button>
          <button onClick={onEnd} className="btn-danger px-3.5 py-1.5 text-sm">
            End
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <div className="mt-10 text-center">
            <p className="text-sm text-ink-dim">Say hello.</p>
            <p className="mono mt-2 text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              peer-to-peer · never stored
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`msg-in flex ${m.mine ? "justify-end" : "justify-start"}`}
          >
            <span
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-snug ${
                m.mine
                  ? "rounded-br-md bg-gradient-to-br from-cyan to-[var(--cyan-deep)] text-[#04121a]"
                  : "rounded-bl-md border border-[var(--hairline)] bg-white/[0.04] text-ink"
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={submit}
        className="flex gap-2 border-t border-[var(--hairline)] p-4"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={connected ? "Type a message…" : "Connecting…"}
          disabled={!connected}
          className="mono flex-1 rounded-full border border-[var(--hairline)] bg-black/30 px-4 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-[var(--cyan)] focus:ring-1 focus:ring-[var(--cyan)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          className="btn-signal px-5 py-2.5 text-sm"
        >
          Send
        </button>
      </form>
    </div>
  );
}
