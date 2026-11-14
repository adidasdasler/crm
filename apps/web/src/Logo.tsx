/** Логотип MioFlow: знак (циферблат с точкой-уведомлением) + слово. */
export function Mark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx="32" cy="32" r="30" fill="#2F3BFF" />
      <circle cx="32" cy="32" r="16" fill="none" stroke="#FFFFFF" strokeWidth="5" />
      <line x1="32" y1="32" x2="32" y2="22" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" />
      <circle cx="47" cy="17" r="7" fill="#FFC7D6" />
    </svg>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="MioFlow">
      <Mark size={size} />
      <span className="font-display leading-none text-ink" style={{ fontSize: size * 1.05 }}>MioFlow</span>
    </span>
  );
}
