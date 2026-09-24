/**
 * Icone da ANA (24/09/2026): rosto feminino amigavel.
 *
 * O cabelo e UM traco grosso continuo -- sobe por um lado, contorna o alto da cabeca e desce
 * pelo outro -- encostado no rosto, que e um circulo de traco fino. E o contraste entre os dois
 * tracos que da o penteado sem pesar o desenho.
 *
 * Tres tentativas anteriores ficam registradas para ninguem repetir: silhueta inteiramente
 * preenchida (o rosto virava mancha, com cara de aviso de "usuario"); cabelo em linha fina em
 * volta do rosto (concentrico, parecia capuz); e cabelo cheio com o rosto aberto (as pontas do
 * cabelo ao lado do queixo viravam presas -- ficou com cara de caveira).
 *
 * Olhos, sorriso e o brilho de IA so entram a partir de 20 px; abaixo disso viram borrao. O que
 * identifica a ANA no tamanho pequeno e a silhueta, legivel ate 14 px.
 */
export function AnaIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  const detalhe = size >= 20
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Rosto */}
      <circle cx="12" cy="10.4" r="4.1" />
      {/* Cabelo */}
      <path
        d="M6.7 13.6c-.5-1.6-.5-3.4.04-5.11A5.6 5.6 0 0 1 17.26 8.49c.54 1.71.54 3.51.04 5.11"
        strokeWidth="3"
      />
      {/* Ombros */}
      <path d="M4.9 20.8c.8-3 3.6-5 7.1-5s6.3 2 7.1 5" />
      {detalhe && (
        <>
          <circle cx="10.5" cy="10.3" r="0.62" fill="currentColor" stroke="none" />
          <circle cx="13.5" cy="10.3" r="0.62" fill="currentColor" stroke="none" />
          <path d="M10.7 12.4c.75.65 1.85.65 2.6 0" />
          {/* Brilho: a ANA e uma assistente de IA, nao so um contato na lista */}
          <path d="M20 3.1l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4z" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  )
}
