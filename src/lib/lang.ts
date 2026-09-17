// Preferencia de idioma do app. Persiste a escolha e ajusta <html lang>.
// (A traducao das telas e aplicada progressivamente.)

export type AppLang = 'pt' | 'en' | 'es'

const KEY = 'tailor.lang'

export const LANGS: { code: AppLang; label: string }[] = [
  { code: 'pt', label: 'Português (Brasil)' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Espanol' },
]

export function getLang(): AppLang {
  const v = localStorage.getItem(KEY)
  return v === 'en' || v === 'es' ? v : 'pt'
}

export function langLabel(code: AppLang): string {
  return LANGS.find((l) => l.code === code)?.label ?? 'Português (Brasil)'
}

export function setLang(l: AppLang): void {
  localStorage.setItem(KEY, l)
  document.documentElement.lang = l === 'pt' ? 'pt-BR' : l
}

/** Aplica o idioma salvo ao carregar o app. */
export function initLang(): void {
  setLang(getLang())
}
