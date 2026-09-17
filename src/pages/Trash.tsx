import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RotateCcw, Trash2, Trash } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../lib/api'
import { deleteAudio } from '../lib/audioStore'
import type { Note } from '../lib/types'
import { fmtRelative } from '../lib/format'
import { EmptyState, Spinner, ConfirmDialog } from '../components/ui'
import { useToast } from '../components/Toast'

export function TrashPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [purgeTarget, setPurgeTarget] = useState<Note | null>(null)
  const [purgeAll, setPurgeAll] = useState(false)
  const toast = useToast()

  function load() {
    if (profile) db.listTrash(profile.id).then(setNotes)
  }
  useEffect(load, [profile])

  async function restore(id: string) {
    setBusy(id)
    await db.restoreNote(id)
    load()
    setBusy(null)
    toast('Nota restaurada')
  }

  async function purge(note: Note) {
    setBusy(note.id)
    try {
      await deleteAudio(note.audio_url)
      await db.deleteNotePermanent(note.id)
      toast('Nota excluída definitivamente', 'info')
    } catch {
      toast('Não consegui excluir a nota', 'error')
    } finally {
      load()
      setBusy(null)
    }
  }

  /** Esvazia a lixeira. Uma falha isolada nao pode abortar o resto. */
  async function purgeEverything() {
    if (!notes?.length) return
    setBusy('all')
    let failed = 0
    for (const n of notes) {
      try {
        await deleteAudio(n.audio_url)
        await db.deleteNotePermanent(n.id)
      } catch {
        failed++
      }
    }
    load()
    setBusy(null)
    if (failed) toast(`${failed} nota(s) não puderam ser excluídas`, 'error')
    else toast('Lixeira esvaziada', 'info')
  }

  return (
    <div className="px-5 safe-top">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/config')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold">Lixeira</h1>
          <p className="text-sm text-content-muted">
            Restaure aqui. Itens na lixeira são excluídos definitivamente após 7 dias.
          </p>
        </div>
      </header>

      {!!notes?.length && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setPurgeAll(true)}
            disabled={busy === 'all'}
            className="btn-danger h-9 px-3 text-sm"
          >
            {busy === 'all' ? <Spinner size={16} /> : <Trash2 size={16} />} Excluir tudo
          </button>
        </div>
      )}

      {notes === null ? (
        <div className="grid place-items-center py-20">
          <Spinner size={24} className="text-accent" />
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={<Trash size={40} />}
          title="Lixeira vazia"
          subtitle="Notas que você excluir aparecem aqui e podem ser restauradas antes da remoção definitiva."
          action={
            <button className="btn-outline" onClick={() => navigate('/')}>
              Voltar para as notas
            </button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="card px-4 py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{n.title}</p>
                <p className="text-xs text-content-muted">Excluida {fmtRelative(n.deleted_at)}</p>
              </div>
              <button
                onClick={() => restore(n.id)}
                disabled={busy === n.id}
                className="btn-ghost h-9 px-3 text-sm"
              >
                <RotateCcw size={16} /> Restaurar
              </button>
              <button
                onClick={() => setPurgeTarget(n)}
                disabled={busy === n.id}
                className="grid place-items-center h-9 w-9 rounded-xl text-content-secondary hover:bg-brand-solid hover:text-white"
                aria-label="Excluir definitivamente"
              >
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={purgeTarget !== null}
        title="Excluir definitivamente?"
        message="Esta ação não pode ser desfeita. A nota será removida permanentemente."
        confirmLabel="Excluir"
        danger
        onConfirm={() => {
          if (purgeTarget) purge(purgeTarget)
        }}
        onClose={() => setPurgeTarget(null)}
      />

      <ConfirmDialog
        open={purgeAll}
        title="Esvaziar a lixeira?"
        message={`As ${notes?.length ?? 0} nota(s) da lixeira serão removidas permanentemente, junto com o áudio. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir tudo"
        danger
        onConfirm={purgeEverything}
        onClose={() => setPurgeAll(false)}
      />
    </div>
  )
}
