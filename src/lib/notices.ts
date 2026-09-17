// Avisos do sininho: CRUD do admin (/admin/dicas). A leitura para o usuario fica em inbox.ts.

import { supabase } from './supabase'
import type { Notice, NoticeAudience, NoticeKind } from './types'

function client() {
  if (!supabase) throw new Error('Supabase nao configurado')
  return supabase
}

export const NOTICE_TITLE_MAX = 80
export const NOTICE_BODY_MAX = 400

/** Todos, inclusive inativos e agendados (admin: a RLS libera tudo so para ele). */
export async function adminListNotices(): Promise<Notice[]> {
  if (!supabase) return []
  const { data, error } = await client().from('notices').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Notice[]
}

export async function createNotice(input: {
  title: string
  body: string
  link: string | null
  kind: NoticeKind
  audience: NoticeAudience
  starts_at: string | null
  ends_at: string | null
  created_by: string
}): Promise<Notice> {
  const { data, error } = await client()
    .from('notices')
    .insert({
      ...input,
      title: input.title.trim(),
      body: input.body.trim(),
      link: input.link?.trim() || null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Notice
}

export async function setNoticeActive(id: string, active: boolean): Promise<void> {
  const { error } = await client().from('notices').update({ active }).eq('id', id)
  if (error) throw error
}

export async function deleteNotice(id: string): Promise<void> {
  const { error } = await client().from('notices').delete().eq('id', id)
  if (error) throw error
}

/** Quantas pessoas marcaram cada aviso como lido. */
export async function noticeReadCounts(): Promise<Map<string, number>> {
  if (!supabase) return new Map()
  const { data, error } = await client().from('notification_reads').select('key').like('key', 'notice:%')
  if (error) throw error
  const counts = new Map<string, number>()
  for (const r of (data ?? []) as { key: string }[]) {
    const id = r.key.slice('notice:'.length)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

export type NoticeStatus = 'active' | 'scheduled' | 'expired' | 'off'

export function noticeStatus(n: Notice, now = Date.now()): NoticeStatus {
  if (!n.active) return 'off'
  if (n.ends_at && Date.parse(n.ends_at) <= now) return 'expired'
  if (n.starts_at && Date.parse(n.starts_at) > now) return 'scheduled'
  return 'active'
}
