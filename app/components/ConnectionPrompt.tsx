"use client";

// Centered prompt for "someone wants to connect" / "someone wants video".
// Framed as an incoming signal: a pulsing ring draws the eye before the choice.
export default function ConnectionPrompt({
  title,
  subtitle,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: {
  title: string;
  subtitle?: string;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="fade-in absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
      <div className="glass-strong rise w-full max-w-sm rounded-3xl p-7 text-center text-ink">
        {/* Incoming-signal beacon */}
        <div className="relative mx-auto mb-5 h-12 w-12">
          <span className="absolute inset-0 rounded-full border border-[var(--cyan)] [animation:sonar_2s_ease-out_infinite]" />
          <span className="absolute inset-0 rounded-full border border-[var(--cyan)] [animation:sonar_2s_ease-out_infinite] [animation-delay:1s]" />
          <span className="absolute inset-[30%] rounded-full bg-cyan shadow-[0_0_16px_var(--cyan)]" />
        </div>

        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-1.5 text-sm text-ink-dim">{subtitle}</p>}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onDecline}
            className="btn-ghost flex-1 px-4 py-2.5 text-sm font-medium"
          >
            {declineLabel}
          </button>
          <button
            onClick={onAccept}
            className="btn-signal flex-1 px-4 py-2.5 text-sm"
          >
            {acceptLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
