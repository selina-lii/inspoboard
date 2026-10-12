// The zen mode icon: an ensō, a circle in one brush stroke with an open end. Same size props as the lucide icons.

export function ZenIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
      <path d="M15.6 4.1A8.4 8.4 0 1 0 20.2 9.4" strokeWidth={2.4} />
      <path d="M20.2 9.4c.3 1 .4 1.8.3 2.6" strokeWidth={1.2} />
    </svg>
  );
}
