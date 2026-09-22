import { useTheme } from '../theme/ThemeProvider'

type LogoPart = 'ana' | 'anaonly'

/** Logo do ANA (troca cor conforme o tema): 'ana' traz o "AI NOTES ADVISOR" embaixo, 'anaonly'
 *  e so a palavra ANA. Desde 22/09/2026 o app nao usa mais a marca Tailor -- as artes "completa"
 *  (ANA by Tailor) e "tailor" foram removidas. */
export function Logo({
  className = '',
  size = 'md',
  part = 'ana',
  heightClass,
  variant = 'auto',
}: {
  className?: string
  /** mantido por compatibilidade; nao usado (a logo ja traz o subtitulo) */
  showTagline?: boolean
  size?: 'sm' | 'md' | 'lg'
  part?: LogoPart
  /** sobrescreve a altura padrao do tamanho (ex.: 'h-11 md:h-12') */
  heightClass?: string
  /** Por padrao a arte segue o TEMA do app. Use quando o fundo nao segue o tema —
   *  ex.: a tela de login e sempre escura, entao pede a arte 'dark' (texto branco).
   *  'light' = arte de texto escuro | 'dark' = arte de texto branco. */
  variant?: 'auto' | 'light' | 'dark'
}) {
  const { theme } = useTheme()
  const suffix = variant === 'auto' ? (theme === 'dark' ? 'dark' : 'light') : variant
  // *-light = texto preto (tema claro); *-dark = texto branco (tema escuro).
  const base = part === 'anaonly' ? 'logo-anaonly' : 'logo-ana'
  const src = `/${base}-${suffix}.png`

  const preset =
    size === 'lg'
      ? 'h-10 sm:h-12 lg:h-14'
      : size === 'sm'
        ? 'h-9'
        : 'h-9 md:h-10'
  const cls = heightClass ?? preset

  return (
    <div className={`inline-flex items-center ${className}`}>
      <img
        src={src}
        alt="ANA"
        className={`w-auto object-contain select-none ${cls}`}
        draggable={false}
      />
    </div>
  )
}
