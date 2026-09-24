import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Check, Copy, Eraser, LifeBuoy, Send } from 'lucide-react'
import { Sheet } from '../components/ui'
import { AnaIcon } from '../components/AnaIcon'
import { askHelp } from '../lib/ai'
import { aiError } from '../lib/aiError'
import { logSilentError } from '../lib/auditLog'
import { useI18n } from '../lib/i18n'

interface Msg {
  role: 'user' | 'ana'
  text: string
  at: string
  /** Resposta que veio da base de ajuda (sem IA) ou de uma sugestao pronta. */
  instant?: boolean
  error?: boolean
}

const STORE_KEY = 'tailor.ana.chat'
/** Quantas mensagens anteriores vao junto para a ANA entender "e no celular?". */
const HISTORY = 6

function loadSaved(): Msg[] {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    const list = raw ? (JSON.parse(raw) as Msg[]) : []
    return Array.isArray(list) ? list.slice(-40) : []
  } catch {
    return []
  }
}

/**
 * Conversa com a ANA (ajuda do app). Refeita em 17/09/2026: folha mais larga no computador,
 * cabecalho com quem esta falando, perguntas prontas sempre a mao, respostas com horario e botao de
 * copiar, memoria das ultimas mensagens (a ANA entende "e no celular?") e saidas para a Central de
 * ajuda e o suporte quando ela nao resolve. A conversa fica guardada enquanto o app estiver aberto.
 */
export function HelpAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const suggestions = useMemo(
    () => [
      { q: t('help.s1'), a: t('help.a1') },
      { q: t('help.s2'), a: t('help.a2') },
      { q: t('help.s3'), a: t('help.a3') },
      { q: t('help.s4'), a: t('help.a4') },
    ],
    [t],
  )
  const [messages, setMessages] = useState<Msg[]>(loadSaved)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Rola SO o container da conversa (nunca o documento): scrollIntoView aqui rolava a pagina
  // inteira por baixo do overlay no iOS.
  useEffect(() => {
    if (!messages.length && !loading) return
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, loading])

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-40)))
    } catch {
      /* ignore */
    }
  }, [messages])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const now = () => new Date().toISOString()

  /** Resposta instantanea (fixa) das perguntas prontas: nao gasta IA. */
  function askFixed(q: string, a: string) {
    if (loading) return
    setMessages((m) => [...m, { role: 'user', text: q, at: now() }, { role: 'ana', text: a, at: now(), instant: true }])
  }

  async function ask(q?: string) {
    const question = (q ?? input).trim()
    if (!question || loading) return
    setInput('')
    const history = messages.slice(-HISTORY).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))
    setMessages((m) => [...m, { role: 'user', text: question, at: now() }])
    setLoading(true)
    try {
      const a = await askHelp(question, lang, history)
      setMessages((m) => [...m, { role: 'ana', text: a, at: now() }])
    } catch (err) {
      logSilentError('client:HelpAssistant.ask', err)
      setMessages((m) => [...m, { role: 'ana', text: aiError(err, t('common.error')), at: now(), error: true }])
    } finally {
      setLoading(false)
    }
  }

  async function copy(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      /* sem area de transferencia */
    }
  }

  function goTo(path: string) {
    onClose()
    navigate(path)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title="ANA"
      headerRight={
        messages.length > 0 ? (
          <button
            onClick={() => setMessages([])}
            className="grid place-items-center h-9 w-9 rounded-full bg-surface-elevated text-content-secondary hover:text-accent"
            aria-label={t('help.clear')}
            title={t('help.clear')}
          >
            <Eraser size={17} />
          </button>
        ) : undefined
      }
    >
      <div className="flex items-center gap-3 rounded-2xl bg-surface-elevated border border-surface-border px-3 py-2.5 mb-3">
        <span className="grid place-items-center h-10 w-10 rounded-full bg-surface-card border-2 border-brand-solid text-accent shrink-0">
          <AnaIcon size={24} />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-sm leading-tight">{t('sidebar.talkAna')}</p>
          <p className="text-xs text-content-muted leading-tight">{t('help.greeting')}</p>
        </div>
      </div>

      <div
        ref={listRef}
        className="h-[46dvh] sm:h-[22rem] overflow-y-auto overscroll-contain space-y-3 mb-3 pr-1"
      >
        {messages.length === 0 ? (
          <div>
            <p className="text-xs uppercase tracking-wide text-content-muted mb-2">{t('help.suggestions')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {suggestions.map((s) => (
                <button
                  key={s.q}
                  onClick={() => askFixed(s.q, s.a)}
                  className="text-left text-sm bg-surface-elevated border border-surface-border rounded-xl px-3 py-2.5 hover:border-accent/40 transition-colors"
                >
                  {s.q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%]">
                  <div className="bg-brand-solid text-white rounded-2xl rounded-br-md px-3.5 py-2 text-sm whitespace-pre-line break-words">
                    {m.text}
                  </div>
                  <p className="text-[10px] text-content-muted text-right mt-0.5">{time(m.at)}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-2">
                <span className="grid place-items-center h-7 w-7 rounded-full bg-surface-card border border-brand-solid text-accent shrink-0 mt-0.5">
                  <AnaIcon size={17} />
                </span>
                <div className="max-w-[85%] min-w-0">
                  <div
                    className={`rounded-2xl rounded-bl-md px-3.5 py-2 text-sm whitespace-pre-line break-words ${
                      m.error
                        ? 'bg-accent/10 border border-accent/30 text-content-primary'
                        : 'bg-surface-elevated text-content-primary'
                    }`}
                  >
                    {m.text}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-content-muted">{time(m.at)}</span>
                    <button
                      onClick={() => copy(i, m.text)}
                      className="inline-flex items-center gap-1 text-[10px] text-content-muted hover:text-content-primary"
                    >
                      {copied === i ? <Check size={11} /> : <Copy size={11} />}
                      {copied === i ? t('note.copied') : t('sh.copy')}
                    </button>
                  </div>
                </div>
              </div>
            ),
          )
        )}
        {loading && (
          <div className="flex gap-2">
            <span className="grid place-items-center h-7 w-7 rounded-full bg-surface-card border border-brand-solid text-accent shrink-0 mt-0.5">
              <AnaIcon size={17} />
            </span>
            <div className="bg-surface-elevated rounded-2xl rounded-bl-md px-3.5 py-3 flex items-center gap-1">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 rounded-full bg-content-muted animate-pulse"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Perguntas prontas continuam a mao depois que a conversa comeca. */}
      {messages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {suggestions.map((s) => (
            <button
              key={s.q}
              onClick={() => askFixed(s.q, s.a)}
              className="whitespace-nowrap text-xs rounded-full bg-surface-elevated border border-surface-border px-3 py-1.5 text-content-secondary hover:text-content-primary"
            >
              {s.q}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          className="input py-2.5"
          placeholder={t('help.placeholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <button
          onClick={() => ask()}
          disabled={loading || !input.trim()}
          className="btn-primary h-11 w-11 rounded-full p-0 shrink-0 disabled:opacity-50"
          aria-label={t('help.send')}
        >
          <Send size={18} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">
        <span className="text-xs text-content-muted">{t('help.footer')}</span>
        <button onClick={() => goTo('/ajuda')} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          <BookOpen size={13} /> {t('settings.helpCenter')}
        </button>
        <button onClick={() => goTo('/suporte')} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          <LifeBuoy size={13} /> {t('settings.contactSupport')}
        </button>
      </div>
    </Sheet>
  )
}
