import { useState } from 'react'
import { Languages, Copy, Check } from 'lucide-react'
import { AutoTextarea, Sheet, Spinner } from '../components/ui'
import { translateText } from '../lib/ai'
import { useT } from '../lib/i18n'
import { useToast } from '../components/Toast'
import type { Note } from '../lib/types'
import { logSilentError } from '../lib/auditLog'

export function TranslateSheet({
  note,
  open,
  onClose,
}: {
  note: Note
  open: boolean
  onClose: () => void
}) {
  const t = useT()
  const toast = useToast()
  // rotulo traduzido -> alvo enviado a IA (em portugues, como a edge espera)
  const LANGS: { label: string; target: string }[] = [
    { label: t('tr.en'), target: 'Ingles' },
    { label: t('tr.es'), target: 'Espanhol' },
    { label: t('tr.fr'), target: 'Frances' },
    { label: t('tr.pt'), target: 'Portugues' },
  ]
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const source = note.summary?.trim() || note.transcript

  async function run(lang: string) {
    setLoading(true)
    setText('')
    try {
      setText(await translateText(source, lang))
    } catch (err) {
      logSilentError('client:TranslateSheet.run', err)
      toast(t('common.error'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('tr.title')}>
      <p className="text-sm text-content-secondary mb-3">{t('tr.intro')}</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {LANGS.map((l) => (
          <button
            key={l.target}
            onClick={() => run(l.target)}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl text-sm font-medium border bg-surface-elevated border-surface-border hover:border-accent/40"
          >
            {l.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-content-muted text-sm">
          <Spinner size={16} /> {t('tr.translating')}
        </div>
      )}

      {text && (
        <>
          <AutoTextarea minRows={8} maxRows={18} className="mb-3 leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn-primary w-full" onClick={copy}>
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? t('tr.copied') : t('tr.copyTr')}
          </button>
        </>
      )}

      {!text && !loading && (
        <div className="text-content-muted text-sm flex items-center gap-2">
          <Languages size={16} /> {t('tr.choose')}
        </div>
      )}
    </Sheet>
  )
}
