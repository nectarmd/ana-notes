import { useState } from 'react'
import { Sparkles, Send } from 'lucide-react'
import { Sheet, Spinner } from '../components/ui'
import { askAllNotes } from '../lib/ai'
import { useT } from '../lib/i18n'
import { useToast } from '../components/Toast'
import type { Note } from '../lib/types'
import { logSilentError } from '../lib/auditLog'
import { withSpeakerNames } from '../lib/speakers'

export function AskNotesSheet({
  open,
  onClose,
  notes,
}: {
  open: boolean
  onClose: () => void
  notes: Note[]
}) {
  const t = useT()
  const toast = useToast()
  const SUGGESTIONS = [t('ask.s1'), t('ask.s2'), t('ask.s3')]
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)

  async function ask(question?: string) {
    const query = (question ?? q).trim()
    if (!query) return
    setQ(query)
    setLoading(true)
    setAnswer('')
    try {
      const a = await askAllNotes(
        query,
        notes.map((n) => ({ title: n.title, created_at: n.created_at, summary: withSpeakerNames(n).summary })),
      )
      setAnswer(a)
    } catch (err) {
      logSilentError('client:AskNotesSheet.ask', err)
      toast(t('common.error'), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('ask.title')}>
      <p className="text-sm text-content-secondary mb-4">
        {t('ask.intro').replace('{n}', String(notes.length))}
      </p>

      <div className="flex items-center gap-2 mb-4">
        <input
          className="input"
          placeholder={t('ask.placeholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <button onClick={() => ask()} disabled={loading || !q.trim()} className="btn-primary h-11 w-11 rounded-full p-0" aria-label="Perguntar">
          {loading ? <Spinner size={18} /> : <Send size={18} />}
        </button>
      </div>

      {!answer && !loading && (
        <div className="space-y-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="w-full text-left text-sm bg-surface-elevated border border-surface-border rounded-xl px-3 py-2.5 hover:border-accent/40"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-content-muted text-sm">
          <Spinner size={16} /> {t('ask.consulting')}
        </div>
      )}

      {answer && (
        <div className="card p-4">
          <div className="flex items-center gap-2 text-accent mb-2 text-sm font-medium">
            <Sparkles size={16} /> {t('ask.answer')}
          </div>
          <p className="whitespace-pre-line leading-relaxed text-sm">{answer}</p>
        </div>
      )}
    </Sheet>
  )
}
