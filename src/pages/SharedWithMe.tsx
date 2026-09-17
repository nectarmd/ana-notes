import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Search, SearchX, Share2, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../lib/api'
import { directoryByIds } from '../lib/directory'
import type { Note, PersonRef } from '../lib/types'
import { fmtDate } from '../lib/format'
import { Avatar, Chip, ConfirmDialog, EmptyState, NoteCardSkeleton, PriorityBadge } from '../components/ui'
import { useToast } from '../components/Toast'
import { useT } from '../lib/i18n'
import { logSilentError } from '../lib/auditLog'
import { toPreviewText } from '../lib/textPreview'
import { unreadSharedIds } from '../lib/inbox'

/**
 * Compartilhados comigo (/compartilhados). Reorganizada em 17/09/2026: filtro por quem enviou
 * (com contagem; Amigos abre ja filtrado via ?de=<id>), busca por titulo/resumo, selo "Nova" para o
 * que ainda nao foi aberto (mesma regra do sininho) e grade que usa a largura toda.
 */
export function SharedWithMePage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const t = useT()
  const toast = useToast()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [authors, setAuthors] = useState<Map<string, PersonRef>>(new Map())
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [pendingLeave, setPendingLeave] = useState<Note | null>(null)
  const [query, setQuery] = useState('')
  const from = params.get('de') ?? 'all'

  function setFrom(id: string) {
    const next = new URLSearchParams(params)
    if (id === 'all') next.delete('de')
    else next.set('de', id)
    setParams(next, { replace: true })
  }

  /** A copia e MINHA (0037): remover = mandar para a minha lixeira. A nota de quem
   *  compartilhou continua intacta. */
  async function confirmLeave() {
    const target = pendingLeave
    if (!target) return
    try {
      await db.deleteNote(target.id)
      setNotes((prev) => (prev ? prev.filter((x) => x.id !== target.id) : prev))
      toast(t('home.left'))
    } catch (err) {
      logSilentError('client:SharedWithMe.confirmLeave', err)
      toast(t('common.error'), 'error')
    }
  }

  useEffect(() => {
    if (!profile) return
    let alive = true

    // Desde 0037, compartilhar cria copia: recebidas = minhas notas com shared_by marcado.
    db.listNotes(profile.id)
      .then(async (all) => {
        const shared = all
          .filter((n) => n.shared_by)
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        // Nome de quem compartilhou vem do diretorio (profiles nao expoe perfil alheio).
        const [people, unread] = await Promise.all([
          directoryByIds([...new Set(shared.map((n) => n.shared_by as string))]),
          unreadSharedIds(profile.id, shared),
        ])
        if (!alive) return
        setNotes(shared)
        setAuthors(people)
        setFresh(unread)
      })
      .catch((err) => {
        if (!alive) return
        setNotes([])
        logSilentError('client:SharedWithMe', err)
        toast(t('common.error'), 'error')
      })

    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const senders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of notes ?? []) counts.set(n.shared_by as string, (counts.get(n.shared_by as string) ?? 0) + 1)
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count, person: authors.get(id) }))
      .sort((a, b) => b.count - a.count)
  }, [notes, authors])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (notes ?? []).filter((n) => {
      if (from !== 'all' && n.shared_by !== from) return false
      if (!q) return true
      return n.title.toLowerCase().includes(q) || (n.summary ?? '').toLowerCase().includes(q)
    })
  }, [notes, from, query])

  const nameOf = (p?: PersonRef) => (p ? `${p.first_name} ${p.last_name}`.trim() : '—')

  return (
    <div className="px-5 safe-top pb-28 md:pb-12">
      <header className="flex items-center gap-3 mb-5">
        {/* No computador o menu lateral ja leva de volta; a seta fica so no celular. */}
        <button
          onClick={() => navigate('/config')}
          className="md:hidden grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold">{t('shared.title')}</h1>
          <p className="text-sm text-content-muted">{t('shared.sub')}</p>
        </div>
      </header>

      {notes === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
          {Array.from({ length: 3 }).map((_, i) => (
            <NoteCardSkeleton key={i} />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={<Share2 size={40} />}
          title={t('shared.emptyTitle')}
          subtitle={t('shared.emptySub')}
          action={
            <button className="btn-outline" onClick={() => navigate('/amigos')}>
              {t('shared.goFriends')}
            </button>
          }
        />
      ) : (
        <>
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
            <div className="relative lg:w-80 shrink-0">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" />
              <input
                className="input pl-11"
                placeholder={t('shared.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {senders.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 min-w-0">
                <Chip active={from === 'all'} onClick={() => setFrom('all')}>
                  {t('home.all')} ({notes.length})
                </Chip>
                {senders.map((s) => (
                  <Chip key={s.id} active={from === s.id} onClick={() => setFrom(s.id)}>
                    <span className="inline-flex items-center gap-1.5">
                      {s.person && <Avatar first={s.person.first_name} last={s.person.last_name} size={18} url={s.person.avatar_url} />}
                      {s.person ? s.person.first_name : '—'} ({s.count})
                    </span>
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon={<SearchX size={36} />}
              title={t('home.noResultTitle')}
              action={
                <button
                  className="btn-outline"
                  onClick={() => {
                    setQuery('')
                    setFrom('all')
                  }}
                >
                  {t('home.clearFilters')}
                </button>
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
              {shown.map((n) => {
                const a = n.shared_by ? authors.get(n.shared_by) : undefined
                const isNew = fresh.has(n.id)
                return (
                  <li key={n.id} className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingLeave(n)
                      }}
                      aria-label={t('home.leave')}
                      title={t('home.leave')}
                      className="absolute right-2 top-2 z-10 grid place-items-center h-8 w-8 rounded-full bg-surface-elevated border border-surface-border text-content-muted hover:text-red-600 dark:hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                    <button
                      onClick={() => navigate(`/nota/${n.id}`)}
                      className={`note-card card w-full h-full text-left p-4 flex flex-col gap-2.5 hover:shadow-hover transition-all ${
                        isNew ? 'border-accent/40' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-9">
                        {a ? (
                          <Avatar first={a.first_name} last={a.last_name} size={26} url={a.avatar_url} />
                        ) : (
                          <span className="h-[26px] w-[26px] rounded-full bg-surface-elevated shrink-0" />
                        )}
                        <span className="text-xs text-content-secondary truncate min-w-0">
                          {t('shared.by').replace('{name}', nameOf(a))}
                        </span>
                        {isNew && (
                          <span className="rounded-full bg-brand-solid text-white text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 shrink-0">
                            {t('shared.new')}
                          </span>
                        )}
                      </div>

                      <div className="flex items-start gap-2 min-w-0">
                        <p className="font-display font-semibold flex-1 min-w-0 line-clamp-2 break-words">{n.title}</p>
                        {n.priority && <PriorityBadge level={n.priority} className="mt-1" />}
                      </div>

                      {n.summary && (
                        <p className="text-sm text-content-secondary line-clamp-3 leading-snug">{toPreviewText(n.summary)}</p>
                      )}

                      <p className="mt-auto pt-2 border-t border-surface-border text-xs text-content-muted">{fmtDate(n.created_at)}</p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!pendingLeave}
        title={t('home.leaveTitle')}
        message={t('home.leaveConfirm').replace('{title}', pendingLeave?.title ?? '')}
        confirmLabel={t('home.leave')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={confirmLeave}
        onClose={() => setPendingLeave(null)}
      />
    </div>
  )
}
