// Amigos e chat efemero. Fala direto com o Supabase: e uma area nova, fora da interface `Db`
// (que o mockDb precisa espelhar inteira). Sem Supabase configurado, tudo vira no-op.

import { supabase } from './supabase'
import { directoryByIds, searchDirectory } from './directory'
import type { FriendEdge, FriendMessage, Friendship, PersonRef } from './types'
import { FRIEND_MSG_MAX } from './types'

function client() {
  if (!supabase) throw new Error('Supabase nao configurado')
  return supabase
}

export const friendsEnabled = () => !!supabase

/**
 * Traz amizades + perfis do outro lado + contagem de nao lidas, em 3 consultas.
 * Retorna aceitos e pendentes juntos; quem chama separa pelo status/`incoming`.
 */
export async function listFriends(me: string): Promise<FriendEdge[]> {
  if (!supabase) return []
  const c = client()

  const { data: links, error } = await c
    .from('friendships')
    .select('*')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
    .order('created_at', { ascending: false })
  if (error) throw error

  const rows = (links ?? []) as Friendship[]
  if (!rows.length) return []

  const otherIds = rows.map((f) => (f.requester_id === me ? f.addressee_id : f.requester_id))

  // Nome/avatar vem do diretorio: `profiles` nao expoe mais o perfil dos outros.
  const byId = await directoryByIds(otherIds)

  // Nao lidas: tudo que me mandaram e ainda nao marquei como lido.
  const { data: unread } = await c
    .from('friend_messages')
    .select('sender_id')
    .eq('recipient_id', me)
    .is('read_at', null)

  const unreadBy = new Map<string, number>()
  for (const m of unread ?? []) unreadBy.set(m.sender_id, (unreadBy.get(m.sender_id) ?? 0) + 1)

  return rows.flatMap((f) => {
    const otherId = f.requester_id === me ? f.addressee_id : f.requester_id
    const person = byId.get(otherId)
    if (!person) return [] // perfil sumiu (conta excluida)
    return [
      {
        friendship: f,
        person,
        incoming: f.status === 'pending' && f.addressee_id === me,
        unread: unreadBy.get(otherId) ?? 0,
      },
    ]
  })
}

/** So os amigos ja aceitos — usado no compartilhamento de notas. */
export async function listAcceptedFriends(me: string): Promise<PersonRef[]> {
  const edges = await listFriends(me)
  return edges.filter((e) => e.friendship.status === 'accepted').map((e) => e.person)
}

/** Busca por nome ou e-mail, excluindo eu mesmo e quem ja tem vinculo comigo. */
export async function searchPeople(me: string, term: string, exclude: string[]): Promise<PersonRef[]> {
  if (!supabase) return []
  return searchDirectory(me, term, exclude)
}

export async function invite(me: string, addresseeId: string): Promise<Friendship> {
  const { data, error } = await client()
    .from('friendships')
    .insert({ requester_id: me, addressee_id: addresseeId })
    .select()
    .single()
  if (error) throw error
  return data as Friendship
}

export async function acceptInvite(friendshipId: string): Promise<void> {
  const { error } = await client()
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('id', friendshipId)
  if (error) throw error
}

/** Serve para recusar convite e para remover amigo. */
export async function removeFriendship(friendshipId: string, me: string, otherId: string): Promise<void> {
  const c = client()
  const { error } = await c.from('friendships').delete().eq('id', friendshipId)
  if (error) throw error

  // O chat nao sobrevive ao vinculo.
  await c
    .from('friend_messages')
    .delete()
    .or(
      `and(sender_id.eq.${me},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${me})`,
    )
}

export async function listMessages(me: string, otherId: string): Promise<FriendMessage[]> {
  if (!supabase) return []
  const { data, error } = await client()
    .from('friend_messages')
    .select('*')
    .or(
      `and(sender_id.eq.${me},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${me})`,
    )
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) throw error
  return (data ?? []) as FriendMessage[]
}

export async function sendMessage(me: string, otherId: string, body: string): Promise<FriendMessage> {
  const text = body.trim().slice(0, FRIEND_MSG_MAX)
  if (!text) throw new Error('Mensagem vazia')
  const { data, error } = await client()
    .from('friend_messages')
    .insert({ sender_id: me, recipient_id: otherId, kind: 'message', body: text })
    .select()
    .single()
  if (error) throw error
  return data as FriendMessage
}

/** "Cutucar": um alerta sem texto. */
export async function poke(me: string, otherId: string): Promise<FriendMessage> {
  const { data, error } = await client()
    .from('friend_messages')
    .insert({ sender_id: me, recipient_id: otherId, kind: 'poke' })
    .select()
    .single()
  if (error) throw error
  return data as FriendMessage
}

export async function markRead(me: string, otherId: string): Promise<void> {
  if (!supabase) return
  await client()
    .from('friend_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', me)
    .eq('sender_id', otherId)
    .is('read_at', null)
}

/** Total de mensagens/cutucadas nao lidas — alimenta o selo em Config. */
export async function unreadCount(me: string): Promise<number> {
  if (!supabase) return 0
  const { count } = await client()
    .from('friend_messages')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', me)
    .is('read_at', null)
  return count ?? 0
}

/** Quantas notas cada pessoa ja me enviou (copias vivas, fora da lixeira). */
export async function receivedCountBySender(me: string): Promise<Map<string, number>> {
  if (!supabase) return new Map()
  const { data, error } = await client()
    .from('notes')
    .select('shared_by')
    .eq('user_id', me)
    .not('shared_by', 'is', null)
    .is('deleted_at', null)
  if (error) throw error
  const counts = new Map<string, number>()
  for (const r of (data ?? []) as { shared_by: string }[]) counts.set(r.shared_by, (counts.get(r.shared_by) ?? 0) + 1)
  return counts
}
