import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Check,
  Eye,
  Info,
  Lightbulb,
  Link2,
  Megaphone,
  Monitor,
  PanelTop,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { adminListTips, createTip, deleteTip, setTipActive } from '../lib/tips'
import {
  NOTICE_BODY_MAX,
  NOTICE_TITLE_MAX,
  adminListNotices,
  createNotice,
  deleteNotice,
  noticeReadCounts,
  noticeStatus,
  setNoticeActive,
  type NoticeStatus,
} from '../lib/notices'
import { getAppSettings, updateAppSettings } from '../lib/appSettings'
import { useAppSettings } from '../app/SettingsProvider'
import type { AnnouncementType, AppSettings, Notice, NoticeAudience, NoticeKind, Tip } from '../lib/types'
import { AutoTextarea, Chip, ConfirmDialog, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { logSilentError } from '../lib/auditLog'
import { fmtDateTime } from '../lib/format'

const TIP_BODY_MAX = 280

type Tab = 'sininho' | 'faixa' | 'dicas'

const TIP_SUGGESTIONS = [
  'Grave uma reunião com um clique usando o botão de gravação inteligente na tela inicial.',
  'Envie uma cópia de uma nota para um colega do ANA: ele recebe a transcrição e o resumo, sem o áudio.',
  'Organize suas notas em pastas coloridas para encontrar tudo mais rápido.',
  'Peça para a ANA gerar um mapa mental da reunião: ótimo para visualizar os principais pontos.',
  'Defina uma prioridade (alta, média, baixa) nas notas mais importantes para não perdê-las de vista.',
  'Envie um áudio ou vídeo já gravado para transcrever e resumir automaticamente.',
  'No app para Windows, o atalho Ctrl+Shift+G começa a gravar a reunião na hora.',
  'O sininho da tela inicial junta avisos, notas recebidas e respostas do suporte.',
]

const WINDOWS_LATEST_URL =
  'https://github.com/tailorexec/tailor-executive-ai-notes/releases/latest/download/ANA-Tailor-Setup-Windows.exe'

/** Destinos prontos para o clique no aviso. "custom" libera um endereco livre. */
const LINK_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Sem link (só leitura)' },
  { value: '/tarefas', label: 'Tarefas' },
  { value: '/agenda', label: 'Agenda' },
  { value: '/amigos', label: 'Amigos' },
  { value: '/compartilhados', label: 'Compartilhados comigo' },
  { value: '/suporte', label: 'Falar com o suporte' },
  { value: '/ajuda', label: 'Central de ajuda' },
  { value: '/config', label: 'Configurações' },
  { value: WINDOWS_LATEST_URL, label: 'Baixar o app para Windows' },
  { value: 'custom', label: 'Outro endereço…' },
]

const NOTICE_KINDS: { v: NoticeKind; label: string; icon: ReactNode }[] = [
  { v: 'info', label: 'Informação', icon: <Info size={14} /> },
  { v: 'novidade', label: 'Novidade', icon: <Sparkles size={14} /> },
  { v: 'alerta', label: 'Alerta', icon: <AlertTriangle size={14} /> },
  { v: 'manutencao', label: 'Manutenção', icon: <Wrench size={14} /> },
]

const AUDIENCES: { v: NoticeAudience; label: string; icon: ReactNode }[] = [
  { v: 'all', label: 'Todos', icon: <Users size={14} /> },
  { v: 'windows', label: 'Só app Windows', icon: <Monitor size={14} /> },
  { v: 'admins', label: 'Só administradores', icon: <ShieldCheck size={14} /> },
]

const NOTICE_TEMPLATES: { label: string; kind: NoticeKind; title: string; body: string; link: string }[] = [
  {
    label: 'Nova versão do Windows',
    kind: 'novidade',
    title: 'Nova versão do app para Windows',
    body: 'Uma nova versão já está disponível. Se o app não atualizar sozinho, baixe e instale por cima.',
    link: WINDOWS_LATEST_URL,
  },
  {
    label: 'Manutenção programada',
    kind: 'manutencao',
    title: 'Manutenção programada',
    body: 'O ANA ficará indisponível por alguns minutos para melhorias. Salve o que estiver fazendo.',
    link: '',
  },
  {
    label: 'Novo recurso',
    kind: 'novidade',
    title: 'Novidade no ANA',
    body: 'Descreva aqui o que mudou e como usar.',
    link: '/ajuda',
  },
]

const ANNOUNCEMENT_TYPES: { v: AnnouncementType; label: string }[] = [
  { v: 'info', label: 'Informação' },
  { v: 'warning', label: 'Alerta' },
  { v: 'maintenance', label: 'Manutenção' },
  { v: 'promo', label: 'Novidade' },
]

const ROTATE_PRESETS: { hours: number; label: string }[] = [
  { hours: 1, label: '1 hora' },
  { hours: 3, label: '3 horas' },
  { hours: 6, label: '6 horas' },
  { hours: 12, label: '12 horas' },
  { hours: 24, label: '1 dia' },
  { hours: 72, label: '3 dias' },
  { hours: 168, label: '7 dias' },
  { hours: 336, label: '14 dias' },
]

const STATUS_STYLE: Record<NoticeStatus, { label: string; cls: string }> = {
  active: { label: 'No ar', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  scheduled: { label: 'Agendado', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  expired: { label: 'Encerrado', cls: 'bg-surface-elevated text-content-muted' },
  off: { label: 'Desativado', cls: 'bg-surface-elevated text-content-muted' },
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}
function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null
}

function PeriodFields({
  start,
  end,
  onStart,
  onEnd,
  hint,
}: {
  start: string | null
  end: string | null
  onStart: (v: string | null) => void
  onEnd: (v: string | null) => void
  hint: string
}) {
  return (
    <>
      <label className="label">Período (opcional)</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          <span className="block text-[11px] text-content-muted mb-1">Início</span>
          <input
            type="datetime-local"
            className="input w-full min-w-0 px-2"
            value={toLocalInput(start)}
            onChange={(e) => onStart(fromLocalInput(e.target.value))}
          />
        </div>
        <div className="min-w-0">
          <span className="block text-[11px] text-content-muted mb-1">Fim</span>
          <input
            type="datetime-local"
            className="input w-full min-w-0 px-2"
            value={toLocalInput(end)}
            onChange={(e) => onEnd(fromLocalInput(e.target.value))}
          />
        </div>
      </div>
      <p className="text-xs text-content-muted mt-1.5">{hint}</p>
    </>
  )
}

function Counter({ used, max }: { used: number; max: number }) {
  const left = max - used
  return <span className={`text-[11px] tabular-nums ${left <= 20 ? 'text-accent' : 'text-content-muted'}`}>{left}</span>
}

/* ------------------------------------------------------------------ Sininho */

function kindIcon(kind: NoticeKind) {
  return NOTICE_KINDS.find((k) => k.v === kind)?.icon ?? <Info size={14} />
}

function kindTone(kind: NoticeKind) {
  return kind === 'alerta'
    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    : kind === 'manutencao'
      ? 'bg-accent/15 text-accent'
      : kind === 'novidade'
        ? 'bg-brand-solid text-white'
        : 'bg-surface-elevated text-content-secondary'
}

function linkLabel(link: string | null): string {
  if (!link) return 'Sem link'
  return LINK_OPTIONS.find((o) => o.value === link)?.label ?? link
}

function NoticesTab() {
  const { profile } = useAuth()
  const toast = useToast()
  const [notices, setNotices] = useState<Notice[] | null>(null)
  const [reads, setReads] = useState<Map<string, number>>(new Map())
  const [kind, setKind] = useState<NoticeKind>('info')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [linkChoice, setLinkChoice] = useState('')
  const [customLink, setCustomLink] = useState('')
  const [audience, setAudience] = useState<NoticeAudience>('all')
  const [startsAt, setStartsAt] = useState<string | null>(null)
  const [endsAt, setEndsAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Notice | null>(null)

  function refresh() {
    adminListNotices()
      .then(setNotices)
      .catch((err) => {
        setNotices([])
        logSilentError('client:AdminTips.notices', err)
        toast('Não foi possível carregar os avisos', 'error')
      })
    noticeReadCounts()
      .then(setReads)
      .catch(() => setReads(new Map()))
  }
  useEffect(refresh, [])

  const link = linkChoice === 'custom' ? customLink.trim() : linkChoice
  const linkInvalid = linkChoice === 'custom' && !!link && !/^(https?:\/\/|\/)/i.test(link)
  const invalidPeriod = !!(startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt))
  const canSave = !!title.trim() && !linkInvalid && !invalidPeriod && !(linkChoice === 'custom' && !link)

  function applyTemplate(tpl: (typeof NOTICE_TEMPLATES)[number]) {
    setKind(tpl.kind)
    setTitle(tpl.title)
    setBody(tpl.body)
    if (LINK_OPTIONS.some((o) => o.value === tpl.link)) {
      setLinkChoice(tpl.link)
    } else {
      setLinkChoice('custom')
      setCustomLink(tpl.link)
    }
  }

  async function save() {
    if (!profile || !canSave) return
    setSaving(true)
    try {
      await createNotice({
        title,
        body,
        link: link || null,
        kind,
        audience,
        starts_at: startsAt,
        ends_at: endsAt,
        created_by: profile.id,
      })
      setTitle('')
      setBody('')
      setLinkChoice('')
      setCustomLink('')
      setStartsAt(null)
      setEndsAt(null)
      setKind('info')
      setAudience('all')
      toast(startsAt && Date.parse(startsAt) > Date.now() ? 'Aviso agendado' : 'Aviso publicado no sininho')
      refresh()
    } catch (err) {
      logSilentError('client:AdminTips.createNotice', err)
      toast('Não foi possível publicar o aviso', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(n: Notice) {
    setBusyId(n.id)
    try {
      await setNoticeActive(n.id, !n.active)
      refresh()
    } catch (err) {
      logSilentError('client:AdminTips.toggleNotice', err)
      toast('Não foi possível atualizar o aviso', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete() {
    const n = pendingDelete
    if (!n) return
    setBusyId(n.id)
    try {
      await deleteNotice(n.id)
      toast('Aviso excluído')
      refresh()
    } catch (err) {
      logSilentError('client:AdminTips.deleteNotice', err)
      toast('Não foi possível excluir o aviso', 'error')
    } finally {
      setBusyId(null)
      setPendingDelete(null)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] xl:items-start">
      <div className="card p-5">
        <h3 className="flex items-center gap-2 font-display font-semibold mb-1">
          <Bell size={18} className="text-accent" /> Novo aviso no sininho
        </h3>
        <p className="text-sm text-content-muted mb-4">
          Aparece no sininho da tela inicial com a bolinha de não lidos. Cada pessoa marca como lido ou clica para ir ao link.
        </p>

        <p className="text-[11px] uppercase tracking-wide text-content-muted mb-1.5">Modelos</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {NOTICE_TEMPLATES.map((tpl) => (
            <button
              key={tpl.label}
              onClick={() => applyTemplate(tpl)}
              className="text-xs rounded-full bg-surface-elevated border border-surface-border px-3 py-1.5 hover:border-accent/40 transition-colors"
            >
              {tpl.label}
            </button>
          ))}
        </div>

        <label className="label">Tipo</label>
        <div className="flex flex-wrap gap-2 mb-4">
          {NOTICE_KINDS.map((k) => (
            <Chip key={k.v} active={kind === k.v} onClick={() => setKind(k.v)}>
              <span className="inline-flex items-center gap-1.5">
                {k.icon} {k.label}
              </span>
            </Chip>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <label className="label">Título</label>
          <Counter used={title.length} max={NOTICE_TITLE_MAX} />
        </div>
        <input
          className="input mb-3"
          maxLength={NOTICE_TITLE_MAX}
          placeholder="Ex.: Nova versão do app para Windows"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="flex items-center justify-between">
          <label className="label">Mensagem (opcional)</label>
          <Counter used={body.length} max={NOTICE_BODY_MAX} />
        </div>
        <AutoTextarea
          minRows={3}
          maxRows={8}
          maxLength={NOTICE_BODY_MAX}
          className="mb-3"
          placeholder="Detalhe o aviso em uma ou duas frases."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />

        <label className="label">Ao clicar, leva para</label>
        <select className="input mb-2" value={linkChoice} onChange={(e) => setLinkChoice(e.target.value)}>
          {LINK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {linkChoice === 'custom' && (
          <>
            <input
              className="input mb-1"
              placeholder="https://… ou /rota-do-app"
              value={customLink}
              onChange={(e) => setCustomLink(e.target.value)}
            />
            {linkInvalid && <p className="text-xs text-accent mb-2">Use um endereço que comece com https:// ou /</p>}
          </>
        )}

        <label className="label mt-3">Quem recebe</label>
        <div className="flex flex-wrap gap-2 mb-4">
          {AUDIENCES.map((a) => (
            <Chip key={a.v} active={audience === a.v} onClick={() => setAudience(a.v)}>
              <span className="inline-flex items-center gap-1.5">
                {a.icon} {a.label}
              </span>
            </Chip>
          ))}
        </div>

        <PeriodFields
          start={startsAt}
          end={endsAt}
          onStart={setStartsAt}
          onEnd={setEndsAt}
          hint="Sem início, publica agora. Sem fim, fica no ar até você desativar."
        />
        {invalidPeriod && <p className="text-xs text-accent mt-1">O fim precisa ser depois do início.</p>}

        {/* Previa: exatamente a linha que vai aparecer no sininho. */}
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-content-muted mt-5 mb-1.5">
          <Eye size={13} /> Prévia no sininho
        </p>
        <div className="rounded-xl border border-surface-border bg-surface-bg p-3 flex items-start gap-3">
          <span className={`grid place-items-center h-9 w-9 rounded-full shrink-0 ${kindTone(kind)}`}>{kindIcon(kind)}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium leading-snug break-words">{title.trim() || 'Título do aviso'}</span>
            {body.trim() && <span className="block text-xs text-content-secondary mt-0.5 break-words line-clamp-2">{body}</span>}
            <span className="block text-[11px] text-content-muted mt-1">
              agora{link ? <span className="text-accent font-medium"> · Abrir</span> : null}
            </span>
          </span>
          <Check size={16} className="text-content-muted shrink-0 mt-1" />
        </div>

        <button onClick={save} disabled={!canSave || saving} className="btn-primary w-full mt-4">
          {saving ? <Spinner size={16} /> : <Bell size={16} />}
          {startsAt && Date.parse(startsAt) > Date.now() ? 'Agendar aviso' : 'Publicar no sininho'}
        </button>
      </div>

      <div className="min-w-0">
        <h3 className="font-display font-semibold mb-3">
          Avisos publicados {notices && notices.length > 0 && <span className="text-xs font-normal text-content-muted">({notices.length})</span>}
        </h3>
        {notices === null ? (
          <div className="grid place-items-center py-16">
            <Spinner className="text-accent" />
          </div>
        ) : notices.length === 0 ? (
          <div className="card p-8 text-center text-sm text-content-muted">
            Nenhum aviso ainda. O primeiro que você publicar aparece aqui, com quantas pessoas já leram.
          </div>
        ) : (
          <ul className="space-y-2">
            {notices.map((n) => {
              const st = STATUS_STYLE[noticeStatus(n)]
              const count = reads.get(n.id) ?? 0
              return (
                <li key={n.id} className="card p-4">
                  <div className="flex items-start gap-3">
                    <span className={`grid place-items-center h-9 w-9 rounded-full shrink-0 ${kindTone(n.kind)}`}>{kindIcon(n.kind)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="font-medium text-sm break-words">{n.title}</p>
                        <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${st.cls}`}>
                          {st.label}
                        </span>
                      </div>
                      {n.body && <p className="text-sm text-content-secondary mt-0.5 break-words whitespace-pre-line">{n.body}</p>}
                      <p className="text-xs text-content-muted mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1">
                          {AUDIENCES.find((a) => a.v === n.audience)?.icon}
                          {AUDIENCES.find((a) => a.v === n.audience)?.label}
                        </span>
                        <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                          <Link2 size={12} className="shrink-0" />
                          <span className="truncate">{linkLabel(n.link)}</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Eye size={12} /> Lido por {count} {count === 1 ? 'pessoa' : 'pessoas'}
                        </span>
                      </p>
                      <p className="text-[11px] text-content-muted mt-1">
                        Criado em {fmtDateTime(n.created_at)}
                        {n.starts_at ? ` · início ${fmtDateTime(n.starts_at)}` : ''}
                        {n.ends_at ? ` · fim ${fmtDateTime(n.ends_at)}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Chip active={n.active} onClick={() => toggle(n)}>
                        {busyId === n.id ? <Spinner size={13} /> : n.active ? 'Ativo' : 'Inativo'}
                      </Chip>
                      <button
                        onClick={() => setPendingDelete(n)}
                        disabled={busyId === n.id}
                        className="grid place-items-center h-8 w-8 rounded-lg text-content-muted hover:text-accent"
                        aria-label="Excluir aviso"
                        title="Excluir aviso"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Excluir aviso?"
        message="O aviso some do sininho de todo mundo. Para só tirar do ar e manter o histórico, use Ativo/Inativo."
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        danger
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ Faixa no topo */

const BANNER_PREVIEW: Record<AnnouncementType, string> = {
  info: 'bg-surface-elevated border-surface-border text-content-primary',
  warning: 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400',
  maintenance: 'bg-accent/15 border-accent/40 text-content-primary',
  promo: 'bg-brand-solid border-brand-600 text-white',
}

function BannerTab() {
  const { refresh } = useAppSettings()
  const toast = useToast()
  const [s, setS] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getAppSettings().then(setS)
  }, [])

  if (!s) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner className="text-accent" />
      </div>
    )
  }
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
      toast(enabled ? 'Faixa publicada' : 'Faixa removida')
    } catch (err) {
      logSilentError('client:AdminTips.banner', err)
      toast('Não foi possível salvar a faixa', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5 max-w-2xl">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="flex items-center gap-2 font-display font-semibold">
          <PanelTop size={18} className="text-accent" /> Faixa no topo
        </h3>
        {s.announcement_enabled && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">
            No ar
          </span>
        )}
      </div>
      <p className="text-sm text-content-muted mb-4">
        Uma mensagem só, no topo de todas as telas, até a pessoa fechar. Também entra no sininho. Use para o que
        todo mundo precisa ver agora.
      </p>

      <label className="label">Tipo</label>
      <div className="flex flex-wrap gap-2 mb-4">
        {ANNOUNCEMENT_TYPES.map((t) => (
          <Chip key={t.v} active={s.announcement_type === t.v} onClick={() => set({ announcement_type: t.v })}>
            {t.label}
          </Chip>
        ))}
      </div>

      <label className="label">Mensagem</label>
      <AutoTextarea
        minRows={2}
        maxRows={8}
        className="mb-3"
        placeholder="Ex.: Nova funcionalidade de reuniões disponível!"
        value={s.announcement_message}
        onChange={(e) => set({ announcement_message: e.target.value })}
      />

      <PeriodFields
        start={s.announcement_starts_at}
        end={s.announcement_ends_at}
        onStart={(v) => set({ announcement_starts_at: v })}
        onEnd={(v) => set({ announcement_ends_at: v })}
        hint="Sem datas, fica no ar até você remover."
      />

      {s.announcement_message.trim() && (
        <>
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-content-muted mt-5 mb-1.5">
            <Eye size={13} /> Prévia
          </p>
          <div className={`flex items-start gap-3 border rounded-2xl px-4 py-3 ${BANNER_PREVIEW[s.announcement_type]}`}>
            <Megaphone size={18} className="shrink-0 mt-0.5" />
            <p className="flex-1 text-sm leading-relaxed whitespace-pre-line break-words">{s.announcement_message}</p>
            <X size={18} className="shrink-0 opacity-70" />
          </div>
        </>
      )}

      <div className="mt-5">
        {s.announcement_enabled ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary flex-1" onClick={() => save(true)} disabled={saving || !s.announcement_message.trim()}>
              {saving ? <Spinner /> : <Check size={18} />} Atualizar faixa
            </button>
            <button className="btn-outline flex-1 text-accent" onClick={() => save(false)} disabled={saving}>
              Remover faixa
            </button>
          </div>
        ) : (
          <button className="btn-primary w-full" onClick={() => save(true)} disabled={saving || !s.announcement_message.trim()}>
            {saving ? <Spinner /> : <Megaphone size={18} />} Publicar faixa
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Dicas */

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
    <div className="card p-5">
      {/* A LINHA INTEIRA e clicavel (nao so a bolinha) -- um alvo de toque pequeno demais e a
          causa mais provavel de "o toggle não funciona" no celular/PWA. */}
      <button onClick={toggle} disabled={saving} className="w-full flex items-center justify-between gap-3 mb-2 disabled:opacity-60">
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
        Ligado: a dica da tela inicial troca sozinha no intervalo escolhido, igual para todo mundo. Desligado: cada
        pessoa só vê a próxima quando dispensa a atual.
      </p>
      <div className={`flex flex-wrap gap-2 ${settings.tips_rotate_enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        {ROTATE_PRESETS.map((p) => (
          <Chip key={p.hours} active={settings.tips_rotate_hours === p.hours} onClick={() => setHours(p.hours)}>
            a cada {p.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function TipsTab() {
  const { profile } = useAuth()
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

  const activeCount = (tips ?? []).filter((t) => t.active).length

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] xl:items-start">
      <div className="space-y-6">
        <div className="card p-5">
          <h3 className="flex items-center gap-2 font-display font-semibold mb-1">
            <Lightbulb size={18} className="text-accent" /> Nova dica
          </h3>
          <p className="text-sm text-content-muted mb-4">Frase curta na tela inicial, uma por vez. A pessoa pode dispensar.</p>

          <p className="text-[11px] uppercase tracking-wide text-content-muted mb-1.5">Sugestões (clique para usar)</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {TIP_SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setBody(s)}
                className="text-xs text-left rounded-xl bg-surface-elevated border border-surface-border px-3 py-2 hover:border-accent/40 transition-colors max-w-xs"
              >
                {s}
              </button>
            ))}
          </div>

          <label className="label">Título (opcional)</label>
          <input className="input mb-3" placeholder="Ex.: Atalho" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex items-center justify-between">
            <label className="label">Dica</label>
            <Counter used={body.length} max={TIP_BODY_MAX} />
          </div>
          <AutoTextarea
            minRows={3}
            maxRows={8}
            placeholder="Escreva a dica…"
            maxLength={TIP_BODY_MAX}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />

          <label className="flex items-center gap-2 text-sm text-content-secondary mt-3 mb-4">
            <input type="checkbox" checked={electronOnly} onChange={(e) => setElectronOnly(e.target.checked)} />
            Somente no app para Windows
          </label>

          <button onClick={save} disabled={!body.trim() || saving} className="btn-primary w-full">
            {saving ? <Spinner size={16} /> : <Lightbulb size={16} />}
            Publicar dica
          </button>
        </div>

        <RotationCard />
      </div>

      <div className="min-w-0">
        <h3 className="font-display font-semibold mb-3">
          Dicas {tips && <span className="text-xs font-normal text-content-muted">({activeCount} {activeCount === 1 ? 'ativa' : 'ativas'} de {tips.length})</span>}
        </h3>
        {tips === null ? (
          <div className="grid place-items-center py-16">
            <Spinner className="text-accent" />
          </div>
        ) : tips.length === 0 ? (
          <div className="card p-8 text-center text-sm text-content-muted">Nenhuma dica criada ainda.</div>
        ) : (
          <ul className="space-y-2">
            {tips.map((tip) => (
              <li key={tip.id} className={`card p-3 flex items-start gap-3 ${tip.active ? '' : 'opacity-70'}`}>
                <Lightbulb size={16} className="text-accent shrink-0 mt-1" />
                <div className="min-w-0 flex-1">
                  {tip.title && <p className="font-medium text-sm">{tip.title}</p>}
                  <p className="text-sm text-content-secondary break-words">{tip.body}</p>
                  {tip.electron_only && (
                    <span className="inline-flex items-center gap-1 mt-1 text-[11px] text-content-muted">
                      <Monitor size={12} /> Somente app para Windows
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
      </div>

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

/* ------------------------------------------------------------------ Pagina */

const TABS: { id: Tab; label: string; icon: ReactNode; desc: string }[] = [
  { id: 'sininho', label: 'Sininho', icon: <Bell size={16} />, desc: 'Lista de avisos com contador; cada pessoa marca como lido' },
  { id: 'faixa', label: 'Faixa no topo', icon: <PanelTop size={16} />, desc: 'Uma mensagem no topo de todas as telas' },
  { id: 'dicas', label: 'Dicas da Home', icon: <Lightbulb size={16} />, desc: 'Frases curtas na tela inicial, uma por vez' },
]

/**
 * Avisos e dicas (/admin/dicas). Reorganizada em 17/09/2026 em tres abas, uma por canal: o
 * sininho (novo), a faixa do topo e as dicas da Home. Antes era uma pagina unica empilhando
 * faixa, rotacao e dicas sem explicar a diferenca entre eles.
 */
export function AdminTips() {
  const navigate = useNavigate()
  const location = useLocation()
  const initial = (location.hash.replace('#', '') as Tab) || 'sininho'
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : 'sininho')

  function pick(next: Tab) {
    setTab(next)
    navigate({ hash: next }, { replace: true })
  }

  return (
    <div className="px-5 safe-top pb-16">
      <header className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate('/admin')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold">Avisos e dicas</h1>
          <p className="text-sm text-content-muted">Três jeitos de falar com todos os usuários</p>
        </div>
      </header>

      <div role="tablist" className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-6">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => pick(t.id)}
              className={`text-left rounded-2xl border px-4 py-3 transition-colors ${
                active
                  ? 'border-accent/40 bg-accent/10'
                  : 'border-surface-border bg-surface-card hover:border-accent/30'
              }`}
            >
              <span className={`flex items-center gap-2 font-semibold text-sm ${active ? 'text-accent' : ''}`}>
                {t.icon} {t.label}
              </span>
              <span className="block text-xs text-content-muted mt-0.5">{t.desc}</span>
            </button>
          )
        })}
      </div>

      {tab === 'sininho' && <NoticesTab />}
      {tab === 'faixa' && <BannerTab />}
      {tab === 'dicas' && <TipsTab />}
    </div>
  )
}
