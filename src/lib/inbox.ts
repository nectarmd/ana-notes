// Sininho da Home: junta num lugar so o que pede atencao do usuario.
//
// Fontes: avisos publicados pelo admin (notices), a faixa de aviso do topo (app_settings), notas
// recebidas, pedidos de amizade, mensagens nao lidas, resposta do suporte e -- para admin --
// chamados novos e alertas abertos (custo, limite, disjuntor da IA). So os avisos do admin tem tabela propria; o resto e derivado na hora, e o
// "marcar como lido" de todos vive em notification_reads, por chave (migration 0042).
// Fala direto com o Supabase, fora da interface `Db` (mesmo padrao de friends.ts e tips.ts).

import { supabase } from './supabase'
import { directoryByIds } from './directory'
import { isElectron } from './electron'
import { announcementActive } from './appSettings'
import type { AppSettings, Notice, NoticeKind, PersonRef } from './types'

export type InboxKind =
  | 'notice'
  | 'announcement'
  | 'shared'
  | 'friend_request'
  | 'message'
  | 'poke'
  | 'ticket_reply'
  | 'ticket_new'
  | 'admin_alert'

export interface InboxItem {
  key: string
  kind: InboxKind
  title: string
  body: string
  /** Rota interna ("/amigos") ou URL externa (https://...). */
  link: string | null
  at: string
  tone: NoticeKind
  person?: PersonRef
  /** Faixa do topo: marcar como lida tambem fecha a faixa neste aparelho. */
  annVersion?: number
}

/** Evento para o sininho recarregar quando outra tela marca algo como lido. */
export const INBOX_CHANGED = 'ana:inbox-changed'
/** Mesma chave do AnnouncementBanner: fechar a faixa ou ler no sininho da no mesmo. */
export const ANN_DISMISS_KEY = 'tailor.ann.dismissed'
export const ANN_DISMISSED_EVENT = 'ana:announcement-dismissed'

/** Eventos derivados mais velhos que isto nao aparecem (a leitura deles e podada em 90 dias). */
const WINDOW_DAYS = 30
/** Lancamento do sininho: notas recebidas antes disto ja foram vistas na lista -- sem este corte,
 *  quem recebeu copias no ultimo mes ganharia um contador cheio de coisa velha no primeiro dia. */
const SHARED_SINCE = '2026-09-17T02:00:00-03:00'

export const inboxEnabled = () => !!supabase

type T = (key: string) => string

const nameOf = (p?: PersonRef) => (p ? `${p.first_name} ${p.last_name}`.trim() : '')

function clip(text: string | null | undefined, max = 140): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function noticeVisible(n: Notice, isAdmin: boolean, now: number): boolean {
  if (!n.active) return false
  if (n.starts_at && Date.parse(n.starts_at) > now) return false
  if (n.ends_at && Date.parse(n.ends_at) <= now) return false
  if (n.audience === 'admins' && !isAdmin) return false
  if (n.audience === 'windows' && !isElectron()) return false
  return true
}

function readAnnDismissed(): number {
  try {
    const v = Number(localStorage.getItem(ANN_DISMISS_KEY))
    return Number.isFinite(v) ? v : -1
  } catch {
    return -1
  }
}

/** A faixa do topo tambem entra no sininho. Calculada na tela (sem rede): as configuracoes ja
 *  sao recarregadas a cada minuto pelo SettingsProvider. */
export function announcementItem(settings: AppSettings | null, t: T): InboxItem | null {
  if (!settings || !announcementActive(settings)) return null
  if (readAnnDismissed() === settings.announcement_version) return null
  const tone: NoticeKind =
    settings.announcement_type === 'warning'
      ? 'alerta'
      : settings.announcement_type === 'maintenance'
        ? 'manutencao'
        : settings.announcement_type === 'promo'
          ? 'novidade'
          : 'info'
  return {
    key: `ann:${settings.announcement_version}`,
    kind: 'announcement',
    title: t('inbox.announcement'),
    body: clip(settings.announcement_message, 240),
    link: null,
    at: settings.announcement_starts_at ?? new Date().toISOString(),
    tone,
    annVersion: settings.announcement_version,
  }
}

/** Tudo que ainda nao foi lido (menos a faixa do topo, ver announcementItem), mais novo primeiro. */
export async function loadInbox(opts: { me: string; isAdmin: boolean; t: T }): Promise<InboxItem[]> {
  const { me, isAdmin, t } = opts
  if (!supabase) return []
  const c = supabase
  const now = Date.now()
  const since = new Date(now - WINDOW_DAYS * 86400000).toISOString()
  const sharedSince = Date.parse(SHARED_SINCE) > Date.parse(since) ? new Date(SHARED_SINCE).toISOString() : since
  const none = Promise.resolve({ data: [] as never[], error: null })

  const [readsR, noticesR, sharedR, requestsR, messagesR, repliesR, openR, alertsR] = await Promise.all([
    // Filtro por user_id obrigatorio: o admin enxerga as leituras de todo mundo (RLS).
    c.from('notification_reads').select('key').eq('user_id', me).order('read_at', { ascending: false }).limit(1000),
    c.from('notices').select('*').eq('active', true).order('created_at', { ascending: false }).limit(30),
    // user_id = eu: a RLS de notes deixa o admin ler as notas de todos.
    c
      .from('notes')
      .select('id, title, shared_by, created_at')
      .eq('user_id', me)
      .not('shared_by', 'is', null)
      .is('deleted_at', null)
      .gte('created_at', sharedSince)
      .order('created_at', { ascending: false })
      .limit(30),
    c.from('friendships').select('id, requester_id, created_at').eq('addressee_id', me).eq('status', 'pending'),
    c
      .from('friend_messages')
      .select('id, sender_id, kind, body, created_at')
      .eq('recipient_id', me)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
    c
      .from('support_tickets')
      .select('id, subject, reply, replied_at')
      .eq('user_id', me)
      .not('replied_at', 'is', null)
      .gte('replied_at', since),
    isAdmin
      ? c
          .from('support_tickets')
          .select('id, user_id, subject, message, created_at')
          .eq('status', 'aberto')
          .is('reply', null)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
      : none,
    isAdmin
      ? c
          .from('admin_alerts')
          .select('id, severity, title, occurrences, last_seen_at')
          .is('resolved_at', null)
          .order('last_seen_at', { ascending: false })
          .limit(20)
      : none,
  ])

  // Sem saber o que ja foi lido, mostrar tudo como novo seria pior do que nao mostrar nada.
  if (readsR.error) throw readsR.error
  const read = new Set<string>((readsR.data ?? []).map((r: { key: string }) => r.key))

  const shared = (sharedR.data ?? []) as { id: string; title: string; shared_by: string; created_at: string }[]
  const requests = (requestsR.data ?? []) as { id: string; requester_id: string; created_at: string }[]
  const messages = (messagesR.data ?? []) as {
    id: string
    sender_id: string
    kind: string
    body: string | null
    created_at: string
  }[]
  const replies = (repliesR.data ?? []) as { id: string; subject: string; reply: string; replied_at: string }[]
  const open = (openR.data ?? []) as { id: string; user_id: string; subject: string; message: string; created_at: string }[]

  const peopleIds = [
    ...shared.map((n) => n.shared_by),
    ...requests.map((r) => r.requester_id),
    ...messages.map((m) => m.sender_id),
    ...open.map((tk) => tk.user_id),
  ]
  let people = new Map<string, PersonRef>()
  if (peopleIds.length) {
    try {
      people = await directoryByIds([...new Set(peopleIds)])
    } catch {
      /* sem nomes o aviso ainda serve */
    }
  }

  const items: InboxItem[] = []

  for (const n of (noticesR.data ?? []) as Notice[]) {
    if (!noticeVisible(n, isAdmin, now)) continue
    items.push({
      key: `notice:${n.id}`,
      kind: 'notice',
      title: n.title,
      body: clip(n.body, 240),
      link: n.link,
      at: n.starts_at && Date.parse(n.starts_at) > Date.parse(n.created_at) ? n.starts_at : n.created_at,
      tone: n.kind,
    })
  }

  for (const n of shared) {
    const person = people.get(n.shared_by)
    items.push({
      key: `shared:${n.id}`,
      kind: 'shared',
      title: t('inbox.shared').replace('{name}', nameOf(person) || t('inbox.someone')),
      body: n.title,
      link: `/nota/${n.id}`,
      at: n.created_at,
      tone: 'info',
      person,
    })
  }

  for (const r of requests) {
    const person = people.get(r.requester_id)
    if (!person) continue // conta excluida
    items.push({
      key: `friendreq:${r.id}`,
      kind: 'friend_request',
      title: t('inbox.friendRequest').replace('{name}', nameOf(person)),
      body: t('inbox.friendRequestSub'),
      link: '/amigos',
      at: r.created_at,
      tone: 'info',
      person,
    })
  }

  // Mensagens: um item por pessoa. A chave inclui a ultima mensagem, entao uma nova reacende o aviso.
  const bySender = new Map<string, typeof messages>()
  for (const m of messages) bySender.set(m.sender_id, [...(bySender.get(m.sender_id) ?? []), m])
  for (const [sender, list] of bySender) {
    const person = people.get(sender)
    if (!person) continue
    const latest = list[0]
    const texts = list.filter((m) => m.kind !== 'poke')
    const onlyPokes = texts.length === 0
    const title = onlyPokes
      ? t('inbox.poke').replace('{name}', nameOf(person))
      : texts.length === 1
        ? t('inbox.message').replace('{name}', nameOf(person))
        : t('inbox.messages').replace('{name}', nameOf(person)).replace('{n}', String(texts.length))
    items.push({
      key: `msg:${sender}:${latest.id}`,
      kind: onlyPokes ? 'poke' : 'message',
      title,
      body: onlyPokes ? '' : clip(texts[0].body),
      link: `/amigos?chat=${sender}`,
      at: latest.created_at,
      tone: 'info',
      person,
    })
  }

  for (const tk of replies) {
    items.push({
      key: `ticket:${tk.id}:${Date.parse(tk.replied_at)}`,
      kind: 'ticket_reply',
      title: t('inbox.ticketReply'),
      body: clip(tk.subject || tk.reply),
      link: '/suporte',
      at: tk.replied_at,
      tone: 'info',
    })
  }

  for (const tk of open) {
    const person = people.get(tk.user_id)
    items.push({
      key: `ticketnew:${tk.id}`,
      kind: 'ticket_new',
      title: t('inbox.ticketNew'),
      body: clip(`${nameOf(person) ? `${nameOf(person)}: ` : ''}${tk.subject || tk.message}`),
      link: '/admin#chamados',
      at: tk.created_at,
      tone: 'alerta',
      person,
    })
  }

  // Chave pelo id: o mesmo alerta repetindo nao reacende o aviso (resolvido e reaberto = id novo).
  for (const a of (alertsR.data ?? []) as { id: string; severity: string; title: string; occurrences: number; last_seen_at: string }[]) {
    items.push({
      key: `alert:${a.id}`,
      kind: 'admin_alert',
      title: a.title,
      body: t('inbox.alertSub').replace('{n}', String(a.occurrences)),
      link: '/admin/api',
      at: a.last_seen_at,
      tone: a.severity === 'warning' ? 'info' : 'alerta',
    })
  }

  return items.filter((i) => !read.has(i.key)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** Das notas recebidas, quais ainda contam como novidade (mesma regra do sininho). */
export async function unreadSharedIds(me: string, notes: { id: string; created_at: string }[]): Promise<Set<string>> {
  if (!supabase || !notes.length) return new Set()
  const since = Math.max(Date.parse(SHARED_SINCE), Date.now() - WINDOW_DAYS * 86400000)
  const recent = notes.filter((n) => Date.parse(n.created_at) >= since)
  if (!recent.length) return new Set()
  const { data, error } = await supabase
    .from('notification_reads')
    .select('key')
    .eq('user_id', me)
    .in(
      'key',
      recent.map((n) => `shared:${n.id}`),
    )
  if (error) return new Set()
  const read = new Set((data ?? []).map((r: { key: string }) => r.key))
  return new Set(recent.filter((n) => !read.has(`shared:${n.id}`)).map((n) => n.id))
}

/** Marca chaves como lidas (sem erro se ja estavam). */
export async function markKeysRead(me: string, keys: string[]): Promise<void> {
  if (!supabase || !me || !keys.length) return
  const { error } = await supabase
    .from('notification_reads')
    .upsert(
      keys.map((key) => ({ user_id: me, key })),
      { onConflict: 'user_id,key', ignoreDuplicates: true },
    )
  if (error) throw error
  window.dispatchEvent(new Event(INBOX_CHANGED))
}

export async function markInboxRead(me: string, items: InboxItem[]): Promise<void> {
  for (const i of items) {
    if (i.kind === 'announcement' && i.annVersion != null) {
      try {
        localStorage.setItem(ANN_DISMISS_KEY, String(i.annVersion))
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event(ANN_DISMISSED_EVENT))
    }
  }
  await markKeysRead(
    me,
    items.filter((i) => i.kind !== 'announcement').map((i) => i.key),
  )
}
