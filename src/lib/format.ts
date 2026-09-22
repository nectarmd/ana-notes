import { format, formatDistanceToNow, type Locale } from 'date-fns'
import { enUS, es, ptBR } from 'date-fns/locale'
import { getLang, type AppLang } from './lang'

/**
 * Datas no idioma que a pessoa escolheu. Ate 22/09/2026 tudo aqui saia em portugues fixo, e o app
 * em ingles mostrava "22 de set. de 2026" e "ha cerca de 10 horas" -- apareceu nas capturas da
 * ficha em ingles da Microsoft Store.
 *
 * O idioma e lido a cada chamada (e so um localStorage): quando a pessoa troca de idioma, o
 * provedor de i18n re-renderiza as telas e as datas acompanham.
 */
const FORMATS: Record<AppLang, { locale: Locale; date: string; dateTime: string; time: string }> = {
  pt: { locale: ptBR, date: "d 'de' MMM. 'de' yyyy", dateTime: "d 'de' MMM. yyyy, HH:mm", time: 'HH:mm' },
  en: { locale: enUS, date: 'MMM d, yyyy', dateTime: 'MMM d, yyyy, h:mm a', time: 'h:mm a' },
  es: { locale: es, date: "d 'de' MMM 'de' yyyy", dateTime: "d 'de' MMM yyyy, HH:mm", time: 'HH:mm' },
}

function fmt(): (typeof FORMATS)[AppLang] {
  try {
    return FORMATS[getLang()] ?? FORMATS.pt
  } catch {
    // localStorage bloqueado (janela anonima restrita): cai no portugues, como era antes.
    return FORMATS.pt
  }
}

/**
 * Datas 'YYYY-MM-DD' sem hora (como as de `<input type="date">`, usadas no prazo das
 * tarefas) sao interpretadas pelo motor JS como meia-noite UTC. Em fuso negativo (Brasil,
 * UTC-3), isso exibe o dia ANTERIOR ao que o usuario escolheu. Aqui elas viram meia-noite
 * LOCAL; timestamps completos (com hora) passam direto, sem mudanca de comportamento.
 */
function toLocalDate(iso: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
}

export function fmtDate(iso: string): string {
  const f = fmt()
  return format(toLocalDate(iso), f.date, { locale: f.locale })
}

export function fmtDateTime(iso: string): string {
  const f = fmt()
  return format(new Date(iso), f.dateTime, { locale: f.locale })
}

export function fmtTime(iso: string): string {
  const f = fmt()
  return format(new Date(iso), f.time, { locale: f.locale })
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return '-'
  return formatDistanceToNow(new Date(iso), { locale: fmt().locale, addSuffix: true })
}

export function fmtDuration(seconds: number): string {
  if (!seconds) return '0 min'
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}min` : `${h}h`
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

export function initials(first: string, last: string): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase()
}
