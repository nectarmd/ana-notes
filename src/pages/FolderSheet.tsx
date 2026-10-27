import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Check, Folder as FolderIcon } from 'lucide-react'
import { ConfirmDialog, Sheet, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { useT } from '../lib/i18n'
import { db } from '../lib/api'
import type { Folder } from '../lib/types'

const COLORS = ['#941010', '#2563eb', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4b5563']
const MAX_FOLDERS = 10

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full transition-transform ${value === c ? 'ring-2 ring-offset-2 ring-offset-surface-card scale-110' : ''}`}
          style={{ background: c }}
          aria-label={c}
        />
      ))}
    </div>
  )
}

export function FolderSheet({
  open,
  onClose,
  userId,
  mode,
  selectedId,
  onSelect,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  userId: string
  mode: 'manage' | 'assign'
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onChanged?: () => void
}) {
  const toast = useToast()
  const t = useT()
  const [folders, setFolders] = useState<Folder[] | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [editing, setEditing] = useState<Folder | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Folder | null>(null)
  const [busy, setBusy] = useState(false)
  const atLimit = (folders?.length ?? 0) >= MAX_FOLDERS

  function load() {
    db.listFolders(userId).then(setFolders)
    onChanged?.()
  }
  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function create() {
    // O Enter chama aqui direto: sem o busy, dois Enters criavam duas pastas iguais.
    if (!name.trim() || busy) return
    if (atLimit) {
      toast(t('folder.limit'), 'info')
      return
    }
    setBusy(true)
    try {
      const f = await db.createFolder(userId, name.trim(), color)
      setName('')
      setColor(COLORS[0])
      if (mode === 'assign') {
        onSelect?.(f.id)
        onClose()
      }
      load()
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    if (!editing) return
    await db.updateFolder(editing.id, { name: editing.name, color: editing.color })
    setEditing(null)
    load()
  }

  async function remove(id: string) {
    await db.deleteFolder(id)
    setPendingDelete(null)
    load()
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'assign' ? t('folder.assignTitle') : t('folder.manageTitle')}>
      {/* Criar nova */}
      <div className="card p-3 mb-4">
        <div className="flex gap-2 mb-2">
          <input
            className="input py-2"
            placeholder={t('folder.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button className="btn-primary h-11 px-4" onClick={create} disabled={busy || !name.trim() || atLimit}>
            <Plus size={18} /> {t('folder.create')}
          </button>
        </div>
        <ColorPicker value={color} onChange={setColor} />
        {mode === 'manage' && (
          <p className={`text-xs mt-2 ${atLimit ? 'text-accent' : 'text-content-muted'}`}>
            {folders?.length ?? 0}/{MAX_FOLDERS} {atLimit ? `· ${t('folder.limit')}` : ''}
          </p>
        )}
      </div>

      {mode === 'assign' && (
        <button
          onClick={() => {
            onSelect?.(null)
            onClose()
          }}
          className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 mb-2 border text-left ${
            !selectedId ? 'border-brand-solid bg-accent/5' : 'border-surface-border bg-surface-elevated'
          }`}
        >
          <FolderIcon size={18} className="text-content-muted" /> {t('folder.none')}
        </button>
      )}

      {folders === null ? (
        <div className="grid place-items-center py-6"><Spinner className="text-accent" /></div>
      ) : folders.length === 0 ? (
        <p className="text-sm text-content-muted text-center py-4">{t('folder.empty')}</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {folders.map((f) =>
            editing?.id === f.id ? (
              <div key={f.id} className="card p-3 space-y-2">
                <input className="input py-2" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <ColorPicker value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
                <div className="flex gap-2">
                  <button className="btn-outline flex-1 h-9" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                  <button className="btn-primary flex-1 h-9" onClick={saveEdit}>{t('common.save')}</button>
                </div>
              </div>
            ) : (
              <div
                key={f.id}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border ${
                  mode === 'assign' && selectedId === f.id ? 'border-brand-solid bg-accent/5' : 'border-surface-border bg-surface-elevated'
                }`}
              >
                <button
                  onClick={() => {
                    if (mode === 'assign') {
                      onSelect?.(f.id)
                      onClose()
                    }
                  }}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <span className="h-4 w-4 rounded-full shrink-0" style={{ background: f.color }} />
                  <span className="font-medium truncate min-w-0 flex-1">{f.name}</span>
                  {mode === 'assign' && selectedId === f.id && <Check size={16} className="text-accent ml-auto" />}
                </button>
                {mode === 'manage' && (
                  <>
                    <button onClick={() => setEditing(f)} className="text-content-muted hover:text-content-primary" aria-label="Editar">
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => setPendingDelete(f)} className="text-content-muted hover:text-accent" aria-label="Excluir">
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            ),
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={t('folder.deleteTitle')}
        message={t('folder.deleteConfirm')}
        confirmLabel={t('home.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => pendingDelete && remove(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </Sheet>
  )
}
