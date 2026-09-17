import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Lightbulb, Megaphone, Monitor, RefreshCw, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { adminListTips, createTip, deleteTip, setTipActive } from '../lib/tips'
import { getAppSettings, updateAppSettings } from '../lib/appSettings'
import { useAppSettings } from '../app/SettingsProvider'
import type { AnnouncementType, AppSettings, Tip } from '../lib/types'
import { Chip, ConfirmDialog, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { logSilentError } from '../lib/auditLog'

const BODY_MAX = 280

const SUGGESTIONS = [
  'Grave uma reunião com um clique usando o botão de gravação inteligente na tela inicial.',
  'Você pode compartilhar uma nota com outra pessoa sem perder o controle sobre ela — quem recebe pode remover o compartilhamento quando quiser.',
  'Organize suas notas em pastas coloridas para encontrar tudo mais rápido.',
  'Peça para a ANA gerar um mapa mental da reunião — ótimo para visualizar os principais pontos.',
  'Defina uma prioridade (alta, média, baixa) nas notas mais importantes para não perdê-las de vista.',
  'Envie um áudio ou vídeo já gravado para transcrever e resumir automaticamente.',
  'No computador, grave o áudio de qualquer chamada (Zoom, Meet, Teams) direto da aba do navegador.',
  'Ative "manter conectado" no login para não precisar digitar sua senha toda vez.',
]

const ANNOUNCEMENT_TYPES: { v: AnnouncementType; label: string }[] = [
  { v: 'info', label: 'Informacao' },
  { v: 'warning', label: 'Alerta' },
  { v: 'maintenance', label: 'Manutencao' },
  { v: 'promo', label: 'Novidade / Promo' },
]

const ROTATE_PRESETS: { hours: number; label: string }[] = [
  { hours: 1, label: '1 hora' },
  { hours: 2, label: '2 horas' },
  { hours: 3, label: '3 horas' },
  { hours: 4, label: '4 horas' },
  { hours: 6, label: '6 horas' },
  { hours: 12, label: '12 horas' },
  { hours: 24, label: '1 dia' },
  { hours: 72, label: '3 dias' },
  { hours: 168, label: '7 dias' },
  { hours: 336, label: '14 dias' },
]

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}
function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null
}

/** Faixa de avisos (banner no topo do app) -- junto com Dicas por serem os dois jeitos de
 *  comunicar algo pra todo mundo, publicados no mesmo lugar. */
function AnnouncementCard() {
  const { refresh } = useAppSettings()
  const [s, setS] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    getAppSettings().then(setS)
  }, [])

  if (!s) return null
  const set = (patch: Partial<AppSettings>) => setS({ ...s, ...patch })

  async function save(enabled: boolean) {
    if (!s) return
    setSaving(true)
    try {
      const next = await updateAppSettings({
        announcement_enabled: enabled,
        announcement_type: s.announcement_type,
        announcement_message: s.announcement_message,
        announcement_starts_at: s.announcement_starts_at,
        announcement_ends_at: s.announcement_ends_at,
        announcement_version: (s.announcement_version ?? 0) + 1,
      })
      setS(next)
      await refresh()
      setOk(true)
      setTimeout(() => setOk(false), 1800)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="flex items-center gap-2 font-display font-semibold">
          <Megaphone size={18} className="text-accent" /> Faixa de avisos
        </h3>
        {s.announcement_enabled && (
          <span className="text-[10px] uppercase tracking-wide bg-green-500/15 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">
            ativo
          </span>
        )}
      </div>

      <label className="label">Tipo</label>
      <div className="flex flex-wrap gap-2 mb-3">
        {ANNOUNCEMENT_TYPES.map((t) => (
          <button
            key={t.v}
            onClick={() => set({ announcement_type: t.v })}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              s.announcement_type === t.v
                ? 'bg-brand-solid border-brand-solid text-white'
                : 'bg-surface-elevated border-surface-border text-content-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className="label">Mensagem</label>
      <textarea
        className="input min-h-[80px] resize-none mb-3"
        placeholder="Ex: Nova funcionalidade de reuniões disponível!"
        value={s.announcement_message}
        onChange={(e) => set({ announcement_message: e.target.value })}
      />

      <label className="label">Período (opcional)</label>
      <div className="space-y-3 mb-1">
        <div className="min-w-0">
          <span className="block text-[11px] text-content-muted mb-1">Inicio</span>
          <input
            type="datetime-local"
            className="input w-full min-w-0 px-2"
            value={toLocalInput(s.announcement_starts_at)}
            onChange={(e) => set({ announcement_starts_at: fromLocalInput(e.target.value) })}
          />
        </div>
        <div className="min-w-0">
          <span className="block text-[11px] text-content-muted mb-1">Fim</span>
          <input
            type="datetime-local"
            className="input w-full min-w-0 px-2"
            value={toLocalInput(s.announcement_ends_at)}
            onChange={(e) => set({ announcement_ends_at: fromLocalInput(e.target.value) })}
          />
        </div>
      </div>
      <p className="text-xs text-content-muted mb-4">Sem datas = fixo até você remover.</p>

      {s.announcement_enabled ? (
        <button className="btn-outline w-full text-accent" onClick={() => save(false)} disabled={saving}>
          {saving ? <Spinner /> : null} Remover aviso
        </button>
      ) : (
        <button className="btn-primary w-full" onClick={() => save(true)} disabled={saving}>
          {saving ? <Spinner /> : ok ? <Check size={18} /> : null}
          {ok ? 'Publicado' : 'Publicar aviso'}
        </button>
      )}
    </div>
  )
}

/** Liga/desliga a rotacao automatica das dicas (troca sozinha a cada N horas, igual pra todo
 *  mundo) -- sem isto, a dica so avanca quando cada usuario dispensa a atual. */
function RotationCard() {
  const { settings, refresh } = useAppSettings()
  const [saving, setSaving] = useState(false)

  if (!settings) return null

  async function toggle() {
    setSaving(true)
    try {
      await updateAppSettings({ tips_rotate_enabled: !settings!.tips_rotate_enabled })
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function setHours(hours: number) {
    setSaving(true)
    try {
      await updateAppSettings({ tips_rotate_hours: hours })
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5 mb-6">
      {/* A LINHA INTEIRA e clicavel (nao so a bolinha) -- um alvo de toque pequeno demais e a
          causa mais provavel de "o toggle não funciona" no celular/PWA. */}
      <button
        onClick={toggle}
        disabled={saving}
        className="w-full flex items-center justify-between gap-3 mb-3 disabled:opacity-60"
      >
        <h3 className="flex items-center gap-2 font-display font-semibold">
          <RefreshCw size={18} className="text-accent" /> Rotação automática
        </h3>
        <span
          className={`h-6 w-11 rounded-full transition-colors relative shrink-0 ${
            settings.tips_rotate_enabled ? 'bg-brand-solid' : 'bg-surface-border'
          }`}
        >
          <span
            className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              settings.tips_rotate_enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </span>
      </button>
      <p className="text-sm text-content-secondary mb-3">
        Quando ligado, a dica mostrada na Home troca sozinha a cada X horas/dias — a mesma dica aparece pra
        todo mundo naquele período, em vez de só avançar quando cada usuário dispensa a atual.
      </p>
      <div className="flex flex-wrap gap-2">
        {ROTATE_PRESETS.map((p) => (
          <Chip key={p.hours} active={settings.tips_rotate_hours === p.hours} onClick={() => setHours(p.hours)}>
            a cada {p.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}

export function AdminTips() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [tips, setTips] = useState<Tip[] | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [electronOnly, setElectronOnly] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Tip | null>(null)

  function refresh() {
    adminListTips()
      .then(setTips)
      .catch((err) => {
        setTips([])
        logSilentError('client:AdminTips.refresh', err)
        toast('Não foi possível carregar as dicas', 'error')
      })
  }

  useEffect(refresh, [])

  async function save() {
    if (!profile || !body.trim()) return
    setSaving(true)
    try {
      await createTip({ body, title: title || null, electron_only: electronOnly, created_by: profile.id })
      setTitle('')
      setBody('')
      setElectronOnly(false)
      toast('Dica publicada')
      refresh()
    } catch (err) {
      logSilentError('client:AdminTips.save', err)
      toast('Não foi possível publicar a dica', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(tip: Tip) {
    setBusyId(tip.id)
    try {
      await setTipActive(tip.id, !tip.active)
      refresh()
    } catch (err) {
      logSilentError('client:AdminTips.toggleActive', err)
      toast('Não foi possível atualizar a dica', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete() {
    const tip = pendingDelete
    if (!tip) return
    setBusyId(tip.id)
    try {
      await deleteTip(tip.id)
      toast('Dica excluída')
      refresh()
    } catch (err) {
      logSilentError('client:AdminTips.delete', err)
      toast('Não foi possível excluir a dica', 'error')
    } finally {
      setBusyId(null)
      setPendingDelete(null)
    }
  }

  return (
    <div className="px-5 safe-top pb-12">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/admin')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Lightbulb size={20} className="text-accent" /> Avisos e Dicas
        </h1>
      </header>

      <AnnouncementCard />
      <RotationCard />

      <div className="card p-4 mb-6">
        <p className="text-xs uppercase tracking-wide text-content-muted mb-2">Sugestões (clique para usar)</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setBody(s)}
              className="text-xs text-left rounded-xl bg-surface-elevated border border-surface-border px-3 py-2 hover:border-accent/40 transition-colors max-w-xs"
            >
              {s}
            </button>
          ))}
        </div>

        <input
          className="input mb-2"
          placeholder="Título (opcional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="input min-h-24 resize-none"
          placeholder="Escreva a dica..."
          maxLength={BODY_MAX}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <p className="text-[11px] text-content-muted mt-1 mb-3">{BODY_MAX - body.length} caracteres restantes</p>

        <label className="flex items-center gap-2 text-sm text-content-secondary mb-4">
          <input type="checkbox" checked={electronOnly} onChange={(e) => setElectronOnly(e.target.checked)} />
          Somente no app Windows
        </label>

        <button onClick={save} disabled={!body.trim() || saving} className="btn-primary">
          {saving ? <Spinner size={16} /> : <Lightbulb size={16} />}
          Publicar dica
        </button>
      </div>

      {tips === null ? (
        <div className="grid place-items-center py-16">
          <Spinner className="text-accent" />
        </div>
      ) : tips.length === 0 ? (
        <p className="text-sm text-content-muted text-center py-8">Nenhuma dica criada ainda.</p>
      ) : (
        <ul className="space-y-2">
          {tips.map((tip) => (
            <li key={tip.id} className="card p-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {tip.title && <p className="font-medium text-sm">{tip.title}</p>}
                <p className="text-sm text-content-secondary">{tip.body}</p>
                {tip.electron_only && (
                  <span className="inline-flex items-center gap-1 mt-1 text-[11px] text-content-muted">
                    <Monitor size={12} /> Somente app Windows
                  </span>
                )}
              </div>
              <Chip active={tip.active} onClick={() => toggleActive(tip)}>
                {busyId === tip.id ? <Spinner size={13} /> : tip.active ? 'Ativa' : 'Inativa'}
              </Chip>
              <button
                onClick={() => setPendingDelete(tip)}
                disabled={busyId === tip.id}
                className="grid place-items-center h-9 w-9 rounded-xl text-content-muted hover:text-accent shrink-0"
                aria-label="Excluir dica"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Excluir dica?"
        message="Esta dica deixa de aparecer para todo mundo imediatamente."
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        danger
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
