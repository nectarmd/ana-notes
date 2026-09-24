/** Icone da ANA: silhueta simples de um rosto feminino (preenchido, cor atual). */
export function AnaIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* Rosto */}
      <circle cx="12" cy="7.5" r="4.3" />
      {/* Cabelo emoldurando o rosto (silhueta feminina) */}
      <path d="M5.4 8.2c0-3.9 3-6.7 6.6-6.7s6.6 2.8 6.6 6.7c0 2.2-.5 4.6-1.3 6.1-.4-2.2-1.2-3.6-2-4.2.3-.6.5-1.3.5-2.1 0-2.4-1.7-4.1-3.8-4.1S8.2 5.6 8.2 8c0 .8.2 1.5.5 2.1-.8.6-1.6 2-2 4.2-.8-1.5-1.3-3.9-1.3-6.1z" />
      {/* Ombros */}
      <path d="M4.8 21.5c0-3.2 3.2-5 7.2-5s7.2 1.8 7.2 5z" />
    </svg>
  )
}
