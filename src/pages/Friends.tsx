import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Hand,
  Info,
  MessageCircle,
  Search,
  Send,
  Share2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import {
  acceptInvite,
  invite,
  listFriends,
  listMessages,
  markRead,
  poke,
  receivedCountBySender,
  removeFriendship,
  searchPeople,
  sendMessage,
} from '../lib/friends'
import { FRIEND_MSG_MAX, type FriendEdge, type FriendMessage, type PersonRef } from '../lib/types'
import { Avatar, ConfirmDialog, EmptyState, Sheet, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { useT } from '../lib/i18n'
import { logSilentError } from '../lib/auditLog'
import { INBOX_CHANGED } from '../lib/inbox'

const fullName = (p: PersonRef) => `${p.first_name} ${p.last_name}`.trim()

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/* ---------------- Chat individual (efemero) ---------------- */
function ChatSheet({
  me,
  friend,
  open,
  onClose,
  onRead,
}: {
  me: string
  friend: PersonRef
  open: boolean
  onClose: () => void
  onRead: () => void
}) {
  const t = useT()
  const toast = useToast()
  const [msgs, setMsgs] = useState<FriendMessage[] | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    listMessages(me, friend.id)
      .then((m) => alive && setMsgs(m))
      .catch(() => alive && setMsgs([]))

    markRead(me, friend.id).then(onRead).catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, friend.id, me])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [msgs])

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const m = await sendMessage(me, friend.id, body)
      setMsgs((prev) => [...(prev ?? []), m])
      setText('')
    } catch (err) {
      logSilentError('client:Friends.send', err)
      toast(t('common.error'), 'error')
    } finally {
      setSending(false)
    }
  }

  const left = FRIEND_MSG_MAX - text.length

  return (
    <Sheet open={open} onClose={onClose} title={fullName(friend)}>
      <p className="flex items-start gap-1.5 text-xs text-content-muted mb-3">
        <Info size={13} className="shrink-0 mt-0.5" />
        <span>{t('friends.ephemeral')}</span>
      </p>

      <div className="h-64 overflow-y-auto overscroll-contain rounded-xl bg-surface-elevated border border-surface-border p-3 mb-3">
        {msgs === null ? (
          <div className="h-full grid place-items-center">
            <Spinner className="text-accent" />
          </div>
        ) : msgs.length === 0 ? (
          <p className="h-full grid place-items-center text-sm text-content-muted">{t('friends.chatEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {msgs.map((m) => {
              const mine = m.sender_id === me
              if (m.kind === 'poke') {
                return (
                  <li key={m.id} className="flex justify-center">
                    <span className="flex items-center gap-1.5 text-xs text-accent bg-accent/10 rounded-full px-3 py-1">
                      <Hand size={12} />
                      {mine
                        ? `${t('friends.youPoked')} ${friend.first_name}`
                        : `${friend.first_name} ${t('friends.pokeLine')}`}
                    </span>
                  </li>
                )
              }
              return (
                <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                      mine ? 'bg-brand-solid text-white' : 'bg-surface-card border border-surface-border'
                    }`}
                  >
                    <p className="text-sm break-words">{m.body}</p>
                    <p className={`text-[10px] mt-0.5 ${mine ? 'text-white/70' : 'text-content-muted'}`}>
                      {timeLabel(m.created_at)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <input
            className="input"
            maxLength={FRIEND_MSG_MAX}
            placeholder={t('friends.messagePlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <p className="text-[11px] text-content-muted mt-1">
            {t('tasks.charsLeft').replace('{n}', String(left))}
          </p>
        </div>
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className="btn-primary h-11 w-11 rounded-xl p-0 shrink-0 disabled:opacity-50"
          aria-label={t('friends.send')}
        >
          {sending ? <Spinner size={16} /> : <Send size={18} />}
        </button>
      </div>
    </Sheet>
  )
}

/* ---------------- Adicionar amigo ---------------- */
function AddFriendSheet({
  me,
  open,
  onClose,
  known,
  onInvited,
}: {
  me: string
  open: boolean
  onClose: () => void
  known: string[]
  onInvited: () => void
}) {
  const t = useT()
  const toast = useToast()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<PersonRef[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const q = term.trim()
    if (q.length < 2) {
      setResults(null)
      return
    }
    // Debounce: a busca bate no banco a cada tecla sem isso.
    const id = setTimeout(() => {
      searchPeople(me, q, known)
        .then(setResults)
        .catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(id)
  }, [term, open, me, known])

  async function add(p: PersonRef) {
    setBusy(p.id)
    try {
      await invite(me, p.id)
      toast(t('friends.invited'))
      setTerm('')
      setResults(null)
      onInvited()
      onClose()
    } catch (err) {
      logSilentError('client:Friends.add', err)
      toast(t('common.error'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('friends.add')}>
      <div className="relative mb-3">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
        <input
          className="input pl-10"
          placeholder={t('friends.searchPlaceholder')}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          // Sem isto o preenchimento automatico do navegador cobre a lista de sugestoes.
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          autoFocus
        />
      </div>

      {results === null ? (
        <p className="text-sm text-content-muted py-6 text-center">{t('friends.searchHint')}</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-content-muted py-6 text-center">{t('friends.noResults')}</p>
      ) : (
        <ul className="space-y-2 max-h-[40vh] overflow-y-auto">
          {results.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-2 rounded-xl bg-surface-elevated">
              <Avatar first={p.first_name} last={p.last_name} size={36} url={p.avatar_url} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{fullName(p)}</p>
                <p className="text-xs text-content-muted truncate">{p.email}</p>
              </div>
              <button
                onClick={() => add(p)}
                disabled={busy === p.id}
                className="btn-outline h-9 px-3 text-sm shrink-0"
              >
                {busy === p.id ? <Spinner size={14} /> : <UserPlus size={15} />}
                {t('friends.invite')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

/* ---------------- Pagina ---------------- */

function SectionTitle({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <h2 className="flex items-center gap-2 text-xs uppercase tracking-wide text-content-muted mb-2 px-1">
      {children}
      <span className="rounded-full bg-surface-elevated border border-surface-border px-1.5 text-[10px] tabular-nums normal-case">
        {count}
      </span>
    </h2>
  )
}

/**
 * Amigos (/amigos). Reorganizada em 17/09/2026: secoes com contagem (convites recebidos, amigos,
 * convites enviados), cartoes em grade que usam a largura da tela, busca quando a lista cresce,
 * "Conversar" explicito com as nao lidas e quantas notas cada pessoa ja te enviou (atalho para
 * Compartilhados comigo filtrado). O sininho abre o chat direto via ?chat=<id>.
 */
export function FriendsPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const t = useT()
  const toast = useToast()
  const me = profile?.id ?? ''

  const [edges, setEdges] = useState<FriendEdge[] | null>(null)
  const [received, setReceived] = useState<Map<string, number>>(new Map())
  const [addOpen, setAddOpen] = useState(false)
  const [chatWith, setChatWith] = useState<PersonRef | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<FriendEdge | null>(null)
  const [filter, setFilter] = useState('')

  const refresh = useCallback(() => {
    if (!me) return
    listFriends(me)
      .then(setEdges)
      .catch((err) => {
        setEdges([])
        logSilentError('client:Friends.refresh', err)
        toast(t('common.error'), 'error')
      })
    receivedCountBySender(me)
      .then(setReceived)
      .catch(() => setReceived(new Map()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me])

  useEffect(refresh, [refresh])

  // Vindo do sininho: abre a conversa com quem mandou a mensagem.
  const chatParam = params.get('chat')
  useEffect(() => {
    if (!chatParam || !edges) return
    const edge = edges.find((e) => e.person.id === chatParam && e.friendship.status === 'accepted')
    if (edge) setChatWith(edge.person)
    const next = new URLSearchParams(params)
    next.delete('chat')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatParam, edges])

  const incoming = useMemo(() => (edges ?? []).filter((e) => e.incoming), [edges])
  const accepted = useMemo(() => (edges ?? []).filter((e) => e.friendship.status === 'accepted'), [edges])
  const outgoing = useMemo(
    () => (edges ?? []).filter((e) => e.friendship.status === 'pending' && !e.incoming),
    [edges],
  )
  const knownIds = useMemo(() => (edges ?? []).map((e) => e.person.id), [edges])

  const shownFriends = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = q
      ? accepted.filter((e) => `${fullName(e.person)} ${e.person.email}`.toLowerCase().includes(q))
      : [...accepted]
    // Quem tem mensagem nova primeiro; depois por nome.
    return list.sort((a, b) => b.unread - a.unread || fullName(a.person).localeCompare(fullName(b.person), 'pt-BR'))
  }, [accepted, filter])

  async function run(key: string, fn: () => Promise<unknown>, okMsg?: string) {
    setBusy(key)
    try {
      await fn()
      if (okMsg) toast(okMsg)
      refresh()
    } catch (err) {
      logSilentError('client:Friends.run', err)
      toast(t('common.error'), 'error')
    } finally {
      setBusy(null)
    }
  }

  const empty = edges !== null && accepted.length === 0 && outgoing.length === 0 && incoming.length === 0

  return (
    <div className="px-5 safe-top pb-28 md:pb-12">
      <header className="flex items-center gap-3 mb-6">
        {/* No computador o menu lateral ja leva de volta; a seta fica so no celular. */}
        <button
          onClick={() => navigate('/config')}
          className="md:hidden grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold">{t('friends.title')}</h1>
          <p className="flex items-start gap-1.5 text-xs text-content-muted mt-0.5">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>{t('friends.ephemeral')}</span>
          </p>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn-primary h-10 px-3 text-sm shrink-0" aria-label={t('friends.add')}>
          <UserPlus size={17} />
          <span className="hidden sm:inline">{t('friends.add')}</span>
        </button>
      </header>

      {edges === null ? (
        <div className="grid place-items-center py-16">
          <Spinner className="text-accent" />
        </div>
      ) : empty ? (
        <EmptyState
          icon={<Users size={40} />}
          title={t('friends.emptyTitle')}
          subtitle={t('friends.emptySub')}
          action={
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              <UserPlus size={17} /> {t('friends.add')}
            </button>
          }
        />
      ) : (
        <div className="space-y-8">
          {incoming.length > 0 && (
            <section>
              <SectionTitle count={incoming.length}>{t('friends.requests')}</SectionTitle>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]">
                {incoming.map((e) => (
                  <li key={e.friendship.id} className="card p-4 border-accent/30">
                    <div className="flex items-center gap-3">
                      <Avatar first={e.person.first_name} last={e.person.last_name} size={44} url={e.person.avatar_url} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{fullName(e.person)}</p>
                        <p className="text-xs text-content-muted truncate">{e.person.email}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => run(e.friendship.id, () => acceptInvite(e.friendship.id), t('friends.accepted'))}
                        disabled={busy === e.friendship.id}
                        className="btn-primary h-9 px-3 text-sm flex-1"
                      >
                        {busy === e.friendship.id ? <Spinner size={14} /> : <Check size={15} />} {t('friends.accept')}
                      </button>
                      <button
                        onClick={() => run(e.friendship.id, () => removeFriendship(e.friendship.id, me, e.person.id))}
                        disabled={busy === e.friendship.id}
                        className="btn-outline h-9 px-3 text-sm flex-1"
                      >
                        {t('friends.decline')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {accepted.length > 0 && (
            <section>
              <div className="flex flex-wrap items-end gap-3 mb-2">
                <SectionTitle count={accepted.length}>{t('friends.mine')}</SectionTitle>
                {accepted.length > 6 && (
                  <div className="relative ml-auto w-full sm:w-64 mb-2">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
                    <input
                      className="input h-9 py-0 pl-9 text-sm"
                      placeholder={t('friends.filter')}
                      value={filter}
                      onChange={(ev) => setFilter(ev.target.value)}
                    />
                  </div>
                )}
              </div>
              {shownFriends.length === 0 ? (
                <p className="text-sm text-content-muted px-1">{t('friends.noResults')}</p>
              ) : (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]">
                  {shownFriends.map((e) => {
                    const notes = received.get(e.person.id) ?? 0
                    return (
                      <li key={e.friendship.id} className="card p-4 flex flex-col">
                        <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            <Avatar first={e.person.first_name} last={e.person.last_name} size={44} url={e.person.avatar_url} />
                            {e.unread > 0 && (
                              <span className="absolute -top-1 -right-1 grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand-solid text-white text-[10px] font-bold ring-2 ring-surface-card">
                                {e.unread}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{fullName(e.person)}</p>
                            <p className="text-xs text-content-muted truncate">{e.person.email}</p>
                          </div>
                          <button
                            onClick={() => setPendingRemove(e)}
                            disabled={busy === e.friendship.id}
                            title={t('friends.remove')}
                            aria-label={t('friends.remove')}
                            className="grid place-items-center h-8 w-8 rounded-lg text-content-muted hover:text-accent shrink-0"
                          >
                            <UserMinus size={16} />
                          </button>
                        </div>

                        <button
                          onClick={() => navigate(`/compartilhados?de=${e.person.id}`)}
                          disabled={notes === 0}
                          className="mt-3 flex items-center gap-1.5 text-xs text-content-muted enabled:hover:text-accent disabled:cursor-default text-left"
                        >
                          <Share2 size={13} className="shrink-0" />
                          {notes === 0
                            ? t('friends.notesNone')
                            : t(notes === 1 ? 'friends.notesOne' : 'friends.notesMany').replace('{n}', String(notes))}
                          {notes > 0 && <ChevronRight size={13} />}
                        </button>

                        <div className="flex gap-2 mt-3 pt-3 border-t border-surface-border">
                          <button
                            onClick={() => setChatWith(e.person)}
                            className={`${e.unread > 0 ? 'btn-primary' : 'btn-outline'} h-9 px-3 text-sm flex-1`}
                          >
                            <MessageCircle size={15} />
                            {e.unread > 0 ? t('friends.chatUnread').replace('{n}', String(e.unread)) : t('friends.chat')}
                          </button>
                          <button
                            onClick={() => run(`poke-${e.person.id}`, () => poke(me, e.person.id), t('friends.pokeSent'))}
                            disabled={busy === `poke-${e.person.id}`}
                            title={t('friends.poke')}
                            className="btn-ghost h-9 px-3 text-sm text-accent"
                          >
                            {busy === `poke-${e.person.id}` ? <Spinner size={15} /> : <Hand size={16} />}
                            {t('friends.poke')}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          {outgoing.length > 0 && (
            <section>
              <SectionTitle count={outgoing.length}>{t('friends.sent')}</SectionTitle>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]">
                {outgoing.map((e) => (
                  <li key={e.friendship.id} className="card p-3 flex items-center gap-3">
                    <Avatar first={e.person.first_name} last={e.person.last_name} size={40} url={e.person.avatar_url} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{fullName(e.person)}</p>
                      <p className="text-xs text-content-muted">{t('friends.pending')}</p>
                    </div>
                    <button
                      onClick={() =>
                        run(e.friendship.id, () => removeFriendship(e.friendship.id, me, e.person.id), t('friends.cancelled'))
                      }
                      disabled={busy === e.friendship.id}
                      className="btn-ghost h-9 px-3 text-xs text-content-muted hover:text-accent shrink-0"
                    >
                      {busy === e.friendship.id ? <Spinner size={13} /> : <X size={14} />} {t('friends.cancelInvite')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        title={t('friends.remove')}
        message={t('friends.removeConfirm')}
        confirmLabel={t('friends.remove')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => {
          const e = pendingRemove
          if (!e) return
          run(e.friendship.id, () => removeFriendship(e.friendship.id, me, e.person.id), t('friends.removed'))
        }}
        onClose={() => setPendingRemove(null)}
      />

      {me && (
        <AddFriendSheet
          me={me}
          open={addOpen}
          onClose={() => setAddOpen(false)}
          known={knownIds}
          onInvited={refresh}
        />
      )}

      {me && chatWith && (
        <ChatSheet
          me={me}
          friend={chatWith}
          open={!!chatWith}
          onClose={() => setChatWith(null)}
          onRead={() => {
            refresh()
            window.dispatchEvent(new Event(INBOX_CHANGED))
          }}
        />
      )}
    </div>
  )
}
