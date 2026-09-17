import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListChecks, Check, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../lib/api'
import { createTask, deleteTask, listTasks, updateTask, tasksEnabled } from '../lib/tasks'
import type { ActionItem, Note, Task, TaskPriority } from '../lib/types'
import { TASK_TEXT_MAX } from '../lib/types'
import { fmtDate } from '../lib/format'
import { AutoTextarea, ConfirmDialog, EmptyState, NoteCardSkeleton, Chip, Sheet, Spinner } from '../components/ui'
import { PRIORITIES, PRIORITY_META, PriorityPicker, TaskFlag } from '../components/TaskPriority'
import { useToast } from '../components/Toast'
import { useT } from '../lib/i18n'
import { logSilentError } from '../lib/auditLog'
import { withSpeakerNames } from '../lib/speakers'

/** Uma linha da lista: item de acao de uma nota, ou tarefa avulsa (note = null). */
type Row = { key: string; item: ActionItem; priority: TaskPriority; note: Note | null; task: Task | null }

/** Itens de acao da IA nao tem o limite de 140 da tabela `tasks`; so um teto de sanidade. */
const NOTE_ITEM_TEXT_MAX = 300

function dueTime(due?: string | null): number {
  if (!due) return Infinity
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T23:59:59` : due)
  return Number.isNaN(t) ? Infinity : t
}

const isIsoDate = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}/.test(s)

type Draft = { text: string; owner: string; due: string; priority: TaskPriority }
const EMPTY_DRAFT: Draft = { text: '', owner: '', due: '', priority: 'normal' }

/** Bandeira clicavel: abre as tres urgencias ali mesmo, sem sair da lista. */
function FlagMenu({ value, disabled, onPick }: { value: TaskPriority; disabled: boolean; onPick: (p: TaskPriority) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="h-8 px-2 rounded-lg hover:bg-surface-elevated flex items-center gap-1"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('tasks.changePriority')}
      >
        <TaskFlag priority={value} withLabel />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 bottom-full mb-1 z-20 min-w-36 rounded-xl border border-surface-border bg-surface-card shadow-float p-1">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              role="menuitemradio"
              aria-checked={p === value}
              onClick={() => {
                setOpen(false)
                if (p !== value) onPick(p)
              }}
              className={`w-full flex items-center gap-2 px-2.5 h-9 rounded-lg text-sm hover:bg-surface-elevated ${p === value ? 'font-semibold' : ''}`}
            >
              <TaskFlag priority={p} />
              <span className="flex-1 text-left">{t(PRIORITY_META[p].key)}</span>
              {p === value && <Check size={14} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TasksPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const t = useT()
  const toast = useToast()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<'open' | 'all' | 'done'>('open')
  const [prio, setPrio] = useState<'all' | TaskPriority>('all')
  const [busy, setBusy] = useState<string | null>(null)

  // Criar e editar usam o mesmo formulario: `editing` null = nova tarefa.
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null)

  useEffect(() => {
    if (!profile) return
    db.listNotes(profile.id)
      .then(setNotes)
      .catch((err) => {
        setNotes([])
        logSilentError('client:Tasks.listNotes', err)
        toast(t('common.error'), 'error')
      })

    if (tasksEnabled()) listTasks(profile.id).then(setTasks).catch(() => setTasks([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const allRows = useMemo<Row[]>(() => {
    if (!notes) return []
    const all: Row[] = []
    for (const n of notes) {
      // A chave inclui a nota: itens de notas antigas tem ids curtos ('1', '2'...) que se repetem entre
      // notas -- como chave sozinha, o React confundia linhas (74 repeticoes no banco em 17/09/2026).
      // Nomes dos falantes no lugar de "Falante B" (texto e responsavel), como na nota.
      const shown = withSpeakerNames(n)
      for (const item of shown.action_items)
        all.push({ key: `${n.id}:${item.id}`, item, priority: item.priority ?? 'normal', note: n, task: null })
    }
    for (const tk of tasks) {
      all.push({
        key: tk.id,
        item: { id: tk.id, text: tk.text, owner: tk.owner, due: tk.due, done: tk.done, priority: tk.priority },
        priority: tk.priority ?? 'normal',
        note: null,
        task: tk,
      })
    }
    return all
  }, [notes, tasks])

  const byStatus = useMemo(
    () => allRows.filter(({ item }) => (filter === 'all' ? true : filter === 'open' ? !item.done : item.done)),
    [allRows, filter],
  )

  const rows = useMemo(() => {
    const f = prio === 'all' ? byStatus.slice() : byStatus.filter((r) => r.priority === prio)
    f.sort((a, b) => {
      if (a.item.done !== b.item.done) return a.item.done ? 1 : -1
      const pa = PRIORITY_META[a.priority].rank
      const pb = PRIORITY_META[b.priority].rank
      if (pa !== pb) return pa - pb
      const da = dueTime(a.item.due)
      const dbb = dueTime(b.item.due)
      if (da !== dbb) return da - dbb
      const ca = a.note?.created_at ?? a.task!.created_at
      const cb = b.note?.created_at ?? b.task!.created_at
      return Date.parse(cb) - Date.parse(ca)
    })
    return f
  }, [byStatus, prio])

  const countByPrio = useMemo(() => {
    const c: Record<TaskPriority, number> = { high: 0, normal: 0, low: 0 }
    for (const r of byStatus) c[r.priority]++
    return c
  }, [byStatus])

  const totalOpen = useMemo(() => allRows.filter((r) => !r.item.done).length, [allRows])

  /**
   * Altera (ou remove, com patch null) UM item de acao de uma nota. Le a nota fresca antes:
   * action_items e gravado como array inteiro, entao duas abas mexendo em itens diferentes ao
   * mesmo tempo fariam a ultima gravacao apagar a mudanca da outra (reduz a janela da corrida).
   */
  async function changeNoteItem(noteId: string, itemId: string, patch: Partial<ActionItem> | null) {
    if (!notes) return
    const note = (await db.getNote(noteId)) ?? notes.find((n) => n.id === noteId)
    if (!note) return
    const items =
      patch === null
        ? note.action_items.filter((a) => a.id !== itemId)
        : note.action_items.map((a) => (a.id === itemId ? { ...a, ...patch } : a))
    const updated = await db.updateNote(noteId, { action_items: items })
    setNotes((prev) => (prev ?? []).map((n) => (n.id === noteId ? updated : n)))
  }

  async function run(id: string, source: string, fn: () => Promise<void>, okMsg?: string) {
    setBusy(id)
    try {
      await fn()
      if (okMsg) toast(okMsg)
    } catch (err) {
      logSilentError(`client:Tasks.${source}`, err)
      toast(t('common.error'), 'error')
    } finally {
      setBusy(null)
    }
  }

  function toggleDone(r: Row) {
    void run(r.key, 'toggle', async () => {
      if (r.note) await changeNoteItem(r.note.id, r.item.id, { done: !r.item.done })
      else {
        const updated = await updateTask(r.task!.id, { done: !r.task!.done })
        setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      }
    })
  }

  function changePriority(r: Row, p: TaskPriority) {
    void run(r.key, 'priority', async () => {
      if (r.note) await changeNoteItem(r.note.id, r.item.id, { priority: p })
      else {
        const updated = await updateTask(r.task!.id, { priority: p })
        setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      }
    })
  }

  function removeRow(r: Row) {
    void run(
      r.key,
      'delete',
      async () => {
        if (r.note) await changeNoteItem(r.note.id, r.item.id, null)
        else {
          await deleteTask(r.task!.id)
          setTasks((prev) => prev.filter((x) => x.id !== r.task!.id))
        }
      },
      t('tasks.deleted'),
    )
  }

  function openNew() {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setFormOpen(true)
  }

  function openEdit(r: Row) {
    setEditing(r)
    setDraft({
      text: r.item.text,
      owner: r.item.owner ?? '',
      due: isIsoDate(r.item.due) ? r.item.due!.slice(0, 10) : '',
      priority: r.priority,
    })
    setFormOpen(true)
  }

  async function submit() {
    if (!profile || !draft.text.trim() || saving) return
    setSaving(true)
    try {
      if (!editing) {
        const created = await createTask(profile.id, draft)
        setTasks((prev) => [created, ...prev])
        toast(t('tasks.created'))
      } else if (editing.note) {
        // Prazo que a IA escreveu por extenso ("proxima semana") nao cabe no campo de data: so
        // troca se a pessoa escolheu uma data ou se o prazo antigo ja era uma data.
        const keepTextDue = !draft.due && editing.item.due && !isIsoDate(editing.item.due)
        await changeNoteItem(editing.note.id, editing.item.id, {
          text: draft.text.trim().slice(0, NOTE_ITEM_TEXT_MAX),
          owner: draft.owner.trim() || null,
          due: keepTextDue ? editing.item.due : draft.due || null,
          priority: draft.priority,
        })
        toast(t('tasks.saved'))
      } else {
        const updated = await updateTask(editing.task!.id, draft)
        setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
        toast(t('tasks.saved'))
      }
      setFormOpen(false)
    } catch (err) {
      logSilentError('client:Tasks.submit', err)
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const textMax = editing?.note ? NOTE_ITEM_TEXT_MAX : TASK_TEXT_MAX
  const charsLeft = textMax - draft.text.length
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div className="px-5 safe-top">
      <header className="flex items-start gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-3xl font-bold flex items-center gap-2.5">
            <ListChecks size={26} className="text-accent" /> {t('tasks.title')}
          </h1>
          <p className="text-sm text-content-muted mt-1">
            {totalOpen} {totalOpen === 1 ? t('tasks.openOne') : t('tasks.openMany')}
          </p>
        </div>
        {tasksEnabled() && (
          <button onClick={openNew} className="btn-primary h-10 rounded-full px-4 shrink-0 mt-1" aria-label={t('tasks.new')}>
            <Plus size={18} /> <span className="hidden sm:inline">{t('tasks.new')}</span>
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Chip active={filter === 'open'} onClick={() => setFilter('open')}>
          {t('tasks.open')}
        </Chip>
        <Chip active={filter === 'done'} onClick={() => setFilter('done')}>
          {t('tasks.done')}
        </Chip>
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          {t('tasks.all')}
        </Chip>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4" role="group" aria-label={t('tasks.priority')}>
        <Chip active={prio === 'all'} onClick={() => setPrio('all')}>
          {t('tasks.allPriorities')}
        </Chip>
        {PRIORITIES.map((p) => (
          <Chip key={p} active={prio === p} onClick={() => setPrio(prio === p ? 'all' : p)}>
            <span className="inline-flex items-center gap-1.5">
              <TaskFlag priority={p} size={13} />
              {t(PRIORITY_META[p].key)}
              <span className="tabular-nums opacity-70">{countByPrio[p]}</span>
            </span>
          </Chip>
        ))}
      </div>

      {notes === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <NoteCardSkeleton key={i} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ListChecks size={40} />} title={t('tasks.emptyTitle')} subtitle={t('tasks.emptySub')} />
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-28 md:pb-10">
          {rows.map((r) => {
            const { item, note } = r
            const due = dueTime(item.due)
            const overdue = !item.done && due !== Infinity && due < today.getTime()
            return (
              <li key={r.key} className="card p-4 flex flex-col">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleDone(r)}
                    disabled={busy === r.key}
                    aria-label={item.done ? t('tasks.markOpen') : t('tasks.markDone')}
                    className={`mt-0.5 h-5 w-5 rounded-md border grid place-items-center shrink-0 transition-colors ${
                      item.done ? 'bg-brand-solid border-brand-solid text-white' : 'border-surface-border hover:border-accent'
                    }`}
                  >
                    {item.done && <Check size={13} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm leading-snug break-words ${item.done ? 'line-through text-content-muted' : ''}`}>{item.text}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs text-content-muted">
                      {item.owner && <span className="font-medium text-content-secondary">{item.owner}</span>}
                      {item.due && due !== Infinity && (
                        <span className={overdue ? 'text-accent font-medium' : ''}>
                          {item.owner ? '· ' : ''}
                          {fmtDate(item.due)}
                          {overdue && ` · ${t('tasks.overdue')}`}
                        </span>
                      )}
                      {item.due && due === Infinity && (
                        <span>
                          {item.owner ? '· ' : ''}
                          {item.due}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-1 border-t border-surface-border pt-2 text-xs text-content-muted">
                  <FlagMenu value={r.priority} disabled={busy === r.key} onPick={(p) => changePriority(r, p)} />
                  <span className="flex-1" />
                  <button
                    onClick={() => openEdit(r)}
                    disabled={busy === r.key}
                    className="grid place-items-center h-8 w-8 rounded-lg hover:bg-surface-elevated hover:text-content-primary"
                    aria-label={t('tasks.edit')}
                    title={t('tasks.edit')}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setPendingDelete(r)}
                    disabled={busy === r.key}
                    className="grid place-items-center h-8 w-8 rounded-lg hover:bg-surface-elevated hover:text-accent"
                    aria-label={t('tasks.delete')}
                    title={t('tasks.delete')}
                  >
                    {busy === r.key ? <Spinner size={14} /> : <Trash2 size={14} />}
                  </button>
                </div>

                {note ? (
                  <button
                    onClick={() => navigate(`/nota/${note.id}`)}
                    className="mt-1 w-full flex items-center gap-2 text-xs text-content-muted hover:text-accent"
                  >
                    <span className="truncate flex-1 text-left">{note.title}</span>
                    <ChevronRight size={14} className="shrink-0" />
                  </button>
                ) : (
                  <p className="mt-1 text-xs text-content-muted">{t('tasks.manual')}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Sheet open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('tasks.edit') : t('tasks.new')}>
        <div className="mb-3">
          <label className="label">{t('tasks.text')}</label>
          <AutoTextarea
            minRows={3}
            maxRows={10}
            className="leading-relaxed"
            maxLength={textMax}
            placeholder={t('tasks.textPlaceholder')}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            autoFocus
          />
          <p className={`text-xs mt-1 ${charsLeft <= 15 ? 'text-accent' : 'text-content-muted'}`}>
            {t('tasks.charsLeft').replace('{n}', String(charsLeft))}
          </p>
        </div>

        <div className="mb-3">
          <label className="label">{t('tasks.priority')}</label>
          <PriorityPicker value={draft.priority} onChange={(priority) => setDraft({ ...draft, priority })} />
        </div>

        {/* O `input type=date` tem largura MINIMA intrinseca (calendario + texto) que o grid nao
            encolhe: em duas colunas ele escapa do card. Empilhados, cada campo ocupa a largura
            do card e nada transborda. */}
        <div className="space-y-3 mb-4">
          <div className="min-w-0">
            <label className="label">{t('tasks.owner')}</label>
            <input
              className="input w-full min-w-0"
              maxLength={60}
              placeholder={t('tasks.ownerPlaceholder')}
              value={draft.owner}
              onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
            />
          </div>
          <div className="min-w-0">
            <label className="label">{t('tasks.due')}</label>
            <input
              type="date"
              className="input w-full min-w-0 px-2"
              value={draft.due}
              onChange={(e) => setDraft({ ...draft, due: e.target.value })}
            />
            {editing?.note && editing.item.due && !isIsoDate(editing.item.due) && !draft.due && (
              <p className="text-xs text-content-muted mt-1">{t('tasks.dueText').replace('{due}', editing.item.due)}</p>
            )}
          </div>
        </div>

        <button className="btn-primary w-full" onClick={submit} disabled={!draft.text.trim() || saving}>
          {saving ? <Spinner /> : editing ? <Check size={18} /> : <Plus size={18} />} {editing ? t('tasks.save') : t('tasks.create')}
        </button>
      </Sheet>

      <ConfirmDialog
        open={!!pendingDelete}
        title={t('tasks.delete')}
        message={
          pendingDelete && (
            <>
              <p className="break-words">{pendingDelete.item.text}</p>
              {pendingDelete.note && (
                <p className="text-xs text-content-muted mt-2">{t('tasks.deleteNoteItem').replace('{title}', pendingDelete.note.title)}</p>
              )}
            </>
          )
        }
        confirmLabel={t('home.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => pendingDelete && removeRow(pendingDelete)}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
