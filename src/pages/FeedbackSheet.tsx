import { useState } from 'react'
import { Sparkles, Copy, Check, Mail } from 'lucide-react'
import { AutoTextarea, Sheet, Spinner } from '../components/ui'
import { generateFeedback } from '../lib/ai'
import type { FeedbackAudience, FeedbackTone } from '../lib/ai'
import { db } from '../lib/api'
import { useAuth } from '../auth/AuthProvider'
import { useT } from '../lib/i18n'
import { useToast } from '../components/Toast'
import type { Note } from '../lib/types'
import { logSilentError } from '../lib/auditLog'

const AUDIENCES: { v: FeedbackAudience; label: string }[] = [
  { v: 'cliente', label: 'Cliente' },
  { v: 'candidato', label: 'Candidato' },
  { v: 'colega', label: 'Colega' },
  { v: 'outro', label: 'Outro' },
]

const TONES: { v: FeedbackTone; label: string }[] = [
  { v: 'serio', label: 'Sério' },
  { v: 'descontraido', label: 'Descontraído/Animado' },
  { v: 'formal', label: 'Formal' },
  { v: 'informal', label: 'Informal' },
]

export function FeedbackSheet({
  note,
  open,
  onClose,
}: {
  note: Note
  open: boolean
  onClose: () => void
}) {
  const { profile } = useAuth()
  const t = useT()
  const toast = useToast()
  const [audience, setAudience] = useState<FeedbackAudience>('cliente')
  const [customAudience, setCustomAudience] = useState('')
  const [tone, setTone] = useState<FeedbackTone>('serio')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    if (audience === 'outro' && !customAudience.trim()) {
      toast('Diga para quem é o feedback (campo "Outro").', 'error')
      return
    }
    setLoading(true)
    try {
      const fb = await generateFeedback(note.transcript, {
        audience,
        customLabel: audience === 'outro' ? customAudience.trim() : undefined,
        tone,
      })
      setText(fb)
      if (profile) await db.logUsage(profile.id, 'ai_feedback', note.id)
    } catch (err) {
      logSilentError('client:FeedbackSheet.generate', err)
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

  function sendWhats() {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }
  function sendEmail() {
    window.location.href = `mailto:?subject=${encodeURIComponent('Feedback')}&body=${encodeURIComponent(text)}`
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('fb.title')}>
      <p className="text-sm text-content-secondary mb-3">{t('fb.intro')}</p>

      <label className="label">Para quem</label>
      <div className="grid grid-cols-2 gap-2 mb-2">
        {AUDIENCES.map((a) => (
          <button
            key={a.v}
            onClick={() => setAudience(a.v)}
            className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
              audience === a.v
                ? 'bg-brand-solid border-brand-solid text-white'
                : 'bg-surface-elevated border-surface-border text-content-secondary'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
      {audience === 'outro' && (
        <input
          className="input mb-4"
          placeholder="Ex: fornecedor, parceiro..."
          maxLength={20}
          value={customAudience}
          onChange={(e) => setCustomAudience(e.target.value)}
        />
      )}
      {audience !== 'outro' && <div className="mb-4" />}

      <label className="label">Tom</label>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {TONES.map((to) => (
          <button
            key={to.v}
            onClick={() => setTone(to.v)}
            className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
              tone === to.v
                ? 'bg-brand-solid border-brand-solid text-white'
                : 'bg-surface-elevated border-surface-border text-content-secondary'
            }`}
          >
            {to.label}
          </button>
        ))}
      </div>

      {!text && (
        <button className="btn-primary w-full mb-2" onClick={generate} disabled={loading}>
          {loading ? <Spinner /> : <Sparkles size={18} />}
          {loading ? t('fb.generating') : t('fb.generate')}
        </button>
      )}

      {text && (
        <>
          <AutoTextarea
            minRows={8}
            maxRows={18}
            className="mb-3 leading-relaxed"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary flex-1" onClick={copy}>
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? t('fb.copied') : t('fb.copy')}
            </button>
            <button className="btn-outline" onClick={sendWhats}>WhatsApp</button>
            <button className="btn-outline" onClick={sendEmail}>
              <Mail size={16} /> {t('fb.email')}
            </button>
          </div>
          <button className="btn-ghost w-full mt-2" onClick={generate} disabled={loading}>
            {loading ? <Spinner /> : <Sparkles size={16} />} {t('fb.again')}
          </button>
        </>
      )}
    </Sheet>
  )
}
