import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronRight,
  FileLock2,
  LogOut,
  Moon,
  ScrollText,
  ShieldCheck,
  Sun,
  Bell,
  HelpCircle,
  Trash2,
  LifeBuoy,
  Pencil,
  Download,
  Languages,
  Check,
  UserX,
  Users,
  Plug,
  BarChart3,
  Share2,
  Timer,
  Info,
  Monitor,
  Smartphone,
  SquarePlus,
  FolderOpen,
  AlertTriangle,
} from 'lucide-react'
import { deleteMyAccount } from '../lib/account'
import { useAuth } from '../auth/AuthProvider'
import { useTheme } from '../theme/ThemeProvider'
import { Avatar, ConfirmDialog, Sheet, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { Logo } from '../components/Logo'
import { db } from '../lib/api'
import { exportNotesMarkdown } from '../lib/share'
import { langLabel, LANGS } from '../lib/lang'
import { useI18n, useT } from '../lib/i18n'
import { RETENTION_CHOICES, RETENTION_DEFAULT, type RetentionDays } from '../lib/types'
import { friendsEnabled, unreadCount } from '../lib/friends'
import { NavTag } from '../components/NavTag'
import { logSilentError } from '../lib/auditLog'
import { APP_NAME, APP_VERSION, isOlderVersion, WINDOWS_REQUIRED_BUILD } from '../lib/version'
import { WINDOWS_APP_DOWNLOAD_URL } from '../lib/windowsApp'
import { ANDROID_APK_DOWNLOAD_URL } from '../lib/androidApp'
import { isElectron, type AnaPaths } from '../lib/electron'

/**
 * Diagnostico visivel do PWA instalado: mostra os valores REAIS que o navegador reporta para
 * a area segura (notch/home indicator) e como ele detecta o modo instalado. Sem isto, um bug
 * de layout no iOS so pode ser investigado por print/descricao — aqui e um numero que da pra
 * ler e me passar direto, sem interpretacao.
 */
function SafeAreaDebug() {
  const [info, setInfo] = useState('')

  useEffect(() => {
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;left:-9999px;top:0;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)'
    document.body.appendChild(probe)
    const cs = getComputedStyle(probe)
    const top = cs.paddingTop
    const bottom = cs.paddingBottom
    document.body.removeChild(probe)

    const standalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true
    const displayModeStandalone = window.matchMedia('(display-mode: standalone)').matches

    setInfo(
      `safe-area top=${top} bottom=${bottom} · navigator.standalone=${standalone} · display-mode=${displayModeStandalone ? 'standalone' : 'browser'}`,
    )
  }, [])

  return <p className="text-[9px] text-content-muted/70 mt-0.5">{info}</p>
}

function SoonTag({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <NavTag variant="muted">{label}</NavTag>
      <ChevronRight size={18} className="text-content-muted" />
    </span>
  )
}

function Row({
  icon,
  label,
  onClick,
  danger,
  right,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  danger?: boolean
  right?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${
        danger ? 'text-accent' : 'text-content-primary'
      }`}
    >
      <span className={danger ? 'text-accent' : 'text-content-secondary'}>{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      {right ?? <ChevronRight size={18} className="text-content-muted" />}
    </button>
  )
}

/** Rotulo + caminho no disco + botao que abre a pasta no Explorer. */
function PathBlock({
  label,
  value,
  hint,
  openLabel,
  onOpen,
}: {
  label: string
  value: string
  hint?: string
  openLabel: string
  onOpen: () => void
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-content-secondary">{label}</p>
        <p className="mt-0.5 font-mono text-xs text-content-primary break-all">{value}</p>
        {hint && <p className="mt-1 text-xs text-content-muted">{hint}</p>}
      </div>
      <button onClick={onOpen} className="btn-ghost h-8 px-2.5 text-xs shrink-0">
        <FolderOpen size={14} /> {openLabel}
      </button>
    </div>
  )
}

/**
 * Onde o app Windows esta DE VERDADE no disco. Nasceu de um caso real (09/2026): a usuaria
 * tinha 3-4 copias do ANA instaladas e usava uma ANTIGA sem saber -- e nada na tela denunciava
 * isso, porque o numero de versao que aparece e o do SITE, e o app nativo e so um wrapper que
 * carrega o site ao vivo (ou seja: identico em todas as copias). Estes caminhos sao a UNICA
 * coisa que diferencia uma copia da outra. O caminho das gravacoes responde a outra pergunta
 * que so dava pra responder por telefone: "onde, no meu PC, esta o audio que nao subiu?".
 * So aparece dentro do app Windows -- no navegador e no PWA a ponte nem existe.
 */
function WindowsAppInfo() {
  const t = useT()
  const toast = useToast()
  const [paths, setPaths] = useState<AnaPaths | null>(null)

  useEffect(() => {
    const bridge = window.anaElectron
    if (!isElectron() || !bridge || typeof bridge.getPaths !== 'function') return
    let alive = true
    bridge
      .getPaths()
      .then((p) => {
        if (alive) setPaths(p)
      })
      .catch(() => {
        /* instalador antigo ou IPC indisponivel: a secao simplesmente nao aparece */
      })
    return () => {
      alive = false
    }
  }, [])

  if (!paths) return null

  const open = (target: string) => window.anaElectron?.openPath?.(target)

  return (
    <>
      <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('winapp.title')}</p>
      <div className="card p-4 mb-8 space-y-4">
        {paths.isStaleCopy && paths.registeredInstallDir && (
          <div className="alert-error">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle size={16} className="shrink-0" /> {t('winapp.staleTitle')}
            </p>
            <p className="mt-1">{t('winapp.staleBody')}</p>
            <p className="mt-1 font-mono text-xs break-all">{paths.registeredInstallDir}</p>
          </div>
        )}
        {paths.otherCopies.length > 0 && (
          <div className="alert-error">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle size={16} className="shrink-0" /> {t('winapp.duplicateTitle')}
            </p>
            {/* Na copia da Loja, a "outra copia" e o instalador antigo: o conselho e desinstala-lo,
                nao "instalar a versao nova" (o pacote da Loja nao remove o instalador antigo). */}
            <p className="mt-1">{t(paths.isStoreBuild ? 'winapp.duplicateStoreBody' : 'winapp.duplicateBody')}</p>
            {paths.otherCopies.map((dir) => (
              <p key={dir} className="mt-1 font-mono text-xs break-all opacity-80">
                {dir}
              </p>
            ))}
          </div>
        )}

        {/* Situacao do app, sem um segundo numero de versao. Ate 17/09/2026 apareciam as duas versoes
            (instalador x site) lado a lado e isso confundia; o que a pessoa precisa saber e se o app
            do Windows esta em dia. A copia antiga (caso real de 09/2026) segue avisada acima. */}
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-content-secondary">{t('winapp.status')}</span>
          {isOlderVersion(paths.version, WINDOWS_REQUIRED_BUILD) ? (
            <button
              onClick={() => {
                if (typeof window.anaElectron?.checkForUpdates === 'function') {
                  window.anaElectron.checkForUpdates()
                  toast(t('update.checking'))
                } else {
                  window.open(WINDOWS_APP_DOWNLOAD_URL, '_blank')
                }
              }}
              className="btn-primary h-8 px-3 text-xs"
            >
              {t('winapp.needsUpdate')}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
              <Check size={15} /> {t('winapp.upToDate')}
            </span>
          )}
        </div>

        <PathBlock
          label={t('winapp.folder')}
          value={paths.installDir}
          openLabel={t('winapp.open')}
          onOpen={() => open(paths.installDir)}
        />
        <PathBlock
          label={t('winapp.recordings')}
          value={paths.recordingsBackupDir}
          hint={t('winapp.recordingsHint')}
          openLabel={t('winapp.open')}
          onOpen={() => open(paths.recordingsBackupDir)}
        />
        {paths.logDir && (
          <PathBlock
            label={t('winapp.logs')}
            value={paths.logFile}
            openLabel={t('winapp.open')}
            onOpen={() => open(paths.logDir)}
          />
        )}
      </div>
    </>
  )
}

export function Settings() {
  const { profile, isAdmin, signOut, updateProfile } = useAuth()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const [delText, setDelText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [delError, setDelError] = useState<string | null>(null)
  const [retOpen, setRetOpen] = useState(false)
  const [retLower, setRetLower] = useState<RetentionDays | null>(null)
  const [unread, setUnread] = useState(0)
  const { lang, setLang, t } = useI18n()

  const retention: RetentionDays = profile?.audio_retention_days ?? RETENTION_DEFAULT

  useEffect(() => {
    if (!profile || !friendsEnabled()) return
    unreadCount(profile.id)
      .then(setUnread)
      .catch(() => setUnread(0))
  }, [profile])

  async function applyRetention(days: RetentionDays) {
    try {
      await updateProfile({ audio_retention_days: days })
      toast(t('settings.autoDeleteSaved'))
    } catch (err) {
      logSilentError('client:Settings.applyRetention', err)
      toast(t('common.error'), 'error')
    }
  }

  function pickRetention(days: RetentionDays) {
    setRetOpen(false)
    if (days === retention) return
    // Encurtar o prazo alcanca gravacoes que ja existem: precisa de confirmacao.
    if (days < retention) {
      setRetLower(days)
      return
    }
    void applyRetention(days)
  }

  async function deleteAccount() {
    setDeleting(true)
    setDelError(null)
    try {
      await deleteMyAccount()
      await signOut()
      navigate('/login', { replace: true })
    } catch (e) {
      setDelError(e instanceof Error ? e.message : t('common.error'))
      setDeleting(false)
    }
  }

  if (!profile) return null

  async function exportData() {
    if (!profile) return
    setExporting(true)
    try {
      const notes = await db.listNotes(profile.id)
      exportNotesMarkdown(notes, `${profile.first_name} ${profile.last_name}`)
      toast(t('settings.exported'))
    } catch {
      toast('Não foi possível exportar os dados', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="px-5 safe-top pb-8 max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl font-bold">{t('settings.title')}</h1>
        {/* No app Windows a etiqueta mostra as DUAS versoes. Antes so aparecia a do site, que e
            a mesma em qualquer copia instalada -- foi o que fez uma usuaria acreditar que
            estava na versao nova enquanto usava um aplicativo de meses atras. */}
        <span className="text-xs font-medium text-content-muted bg-surface-elevated border border-surface-border rounded-full px-2.5 py-1 shrink-0">
          {APP_VERSION}
        </span>
      </header>

      <button
        onClick={() => navigate('/perfil')}
        className="card p-5 w-full flex items-center gap-4 mb-6 text-left hover:border-accent/40 transition-colors"
      >
        <Avatar first={profile.first_name} last={profile.last_name} size={56} url={profile.avatar_url} />
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-lg truncate">
            {profile.first_name} {profile.last_name}
          </p>
          <p className="text-content-muted text-sm truncate">{profile.email}</p>
          {profile.phone && <p className="text-content-muted text-sm truncate">{profile.phone}</p>}
        </div>
        <span
          className="grid place-items-center h-9 w-9 rounded-full bg-surface-elevated border border-surface-border text-content-secondary shrink-0"
          aria-hidden
        >
          <Pencil size={16} />
        </span>
      </button>

      {isAdmin && (
        <>
          <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('settings.admin')}</p>
          <div className="card divide-y divide-surface-border mb-6">
            {/* Custos das APIs, log de auditoria e avisos ficam DENTRO do painel (pedido de
                17/09/2026): aqui so a porta de entrada. */}
            <Row
              icon={<ShieldCheck size={20} className="text-accent" />}
              label={t('settings.adminPanel')}
              onClick={() => navigate('/admin')}
            />
          </div>
        </>
      )}

      <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('settings.more')}</p>
      <div className="card divide-y divide-surface-border mb-6">
        <Row
          icon={<Users size={20} />}
          label={t('settings.friends')}
          onClick={() => navigate('/amigos')}
          right={
            unread > 0 ? (
              <span className="flex items-center gap-1.5">
                <span className="grid place-items-center min-w-5 h-5 px-1.5 rounded-full bg-brand-solid text-white text-xs font-semibold">
                  {unread}
                </span>
                <ChevronRight size={18} className="text-content-muted" />
              </span>
            ) : undefined
          }
        />
        <Row
          icon={<Share2 size={20} />}
          label={t('settings.sharedWithMe')}
          onClick={() => navigate('/compartilhados')}
        />
        <Row
          icon={<Plug size={20} />}
          label={t('settings.connectors')}
          onClick={() => navigate('/conectores')}
          right={<SoonTag label={t('nav.soon')} />}
        />
        <Row
          icon={<BarChart3 size={20} />}
          label={t('settings.analytics')}
          onClick={() => navigate('/analytics')}
          right={<SoonTag label={t('nav.soon')} />}
        />
      </div>

      <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('settings.prefs')}</p>
      <div className="card divide-y divide-surface-border mb-6">
        <Row
          icon={theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
          label={t('settings.darkTheme')}
          onClick={toggle}
          right={
            <span
              className={`h-6 w-11 rounded-full transition-colors relative ${
                theme === 'dark' ? 'bg-brand-solid' : 'bg-surface-border'
              }`}
            >
              <span
                className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  theme === 'dark' ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </span>
          }
        />
        <Row
          icon={<Bell size={20} />}
          label={t('settings.notifications')}
          onClick={() => navigate('/notificacoes')}
        />
        <Row
          icon={<Languages size={20} />}
          label={t('settings.appLang')}
          onClick={() => setLangOpen(true)}
          right={
            <span className="flex items-center gap-1 text-sm text-content-muted">
              {langLabel(lang)}
              <ChevronRight size={18} />
            </span>
          }
        />
        <Row
          icon={<Timer size={20} />}
          label={t('settings.autoDelete')}
          onClick={() => setRetOpen(true)}
          right={
            <span className="flex items-center gap-1 text-sm text-content-muted">
              {t('settings.autoDeleteDays').replace('{n}', String(retention))}
              <ChevronRight size={18} />
            </span>
          }
        />
      </div>

      <Sheet open={retOpen} onClose={() => setRetOpen(false)} title={t('settings.autoDelete')}>
        <p className="text-sm text-content-secondary mb-4">{t('settings.autoDeleteDesc')}</p>
        <div className="space-y-2">
          {RETENTION_CHOICES.map((d) => (
            <button
              key={d}
              onClick={() => pickRetention(d)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                retention === d
                  ? 'border-brand-solid bg-accent/10'
                  : 'border-surface-border bg-surface-elevated hover:border-accent/40'
              }`}
            >
              <span className="font-medium">{t('settings.autoDeleteDays').replace('{n}', String(d))}</span>
              {retention === d && <Check size={18} className="text-accent" />}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={langOpen} onClose={() => setLangOpen(false)} title={t('settings.appLang')}>
        <div className="space-y-2">
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLang(l.code)
                setLangOpen(false)
                toast(t('settings.langChanged'))
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                lang === l.code
                  ? 'border-brand-solid bg-accent/10'
                  : 'border-surface-border bg-surface-elevated hover:border-accent/40'
              }`}
            >
              <span className="font-medium">{l.label}</span>
              {lang === l.code && <Check size={18} className="text-accent" />}
            </button>
          ))}
        </div>
        <p className="text-xs text-content-muted mt-4">{t('settings.langNote')}</p>
      </Sheet>

      <ConfirmDialog
        open={retLower !== null}
        title={t('settings.autoDeleteLower')}
        message={t('settings.autoDeleteLowerWarn').replace('{n}', String(retLower ?? ''))}
        confirmLabel={t('common.save')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => retLower !== null && applyRetention(retLower)}
        onClose={() => setRetLower(null)}
      />

      <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('settings.myData')}</p>
      <div className="card divide-y divide-surface-border mb-6">
        <Row
          icon={<Download size={20} />}
          label={t('settings.exportData')}
          onClick={exportData}
          right={exporting ? <Spinner size={16} /> : undefined}
        />
        <Row icon={<Trash2 size={20} />} label={t('settings.trash')} onClick={() => navigate('/lixeira')} />
      </div>

      <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('settings.apps')}</p>
      <div className="card divide-y divide-surface-border mb-6">
        <Row
          icon={<Monitor size={20} />}
          label={t('settings.downloadWindows')}
          onClick={() => window.open(WINDOWS_APP_DOWNLOAD_URL, '_blank')}
          right={
            <span className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-content-muted">{APP_VERSION}</span>
              <ChevronRight size={18} className="text-content-muted" />
            </span>
          }
        />
        <Row
          icon={<Smartphone size={20} />}
          label={t('settings.downloadAndroid')}
          onClick={() => window.open(ANDROID_APK_DOWNLOAD_URL, '_blank')}
        />
        <Row icon={<SquarePlus size={20} />} label={t('settings.installPwa')} onClick={() => navigate('/instalar')} />
      </div>

      <WindowsAppInfo />

      <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('settings.support')}</p>
      <div className="card divide-y divide-surface-border mb-6">
        <Row icon={<LifeBuoy size={20} />} label={t('settings.contactSupport')} onClick={() => navigate('/suporte')} />
        <Row icon={<HelpCircle size={20} />} label={t('settings.helpCenter')} onClick={() => navigate('/ajuda')} />
        <Row icon={<Info size={20} />} label={t('about.title')} onClick={() => navigate('/sobre')} />
        <Row icon={<ScrollText size={20} />} label={t('settings.terms')} onClick={() => navigate('/termos')} />
        <Row icon={<FileLock2 size={20} />} label={t('settings.privacy')} onClick={() => navigate('/privacidade')} />
      </div>

      <div className="card mb-4">
        <Row icon={<LogOut size={20} />} label={t('settings.logout')} danger onClick={signOut} right={<span />} />
      </div>

      <div className="card mb-10">
        <Row
          icon={<UserX size={20} />}
          label={t('settings.deleteAccount')}
          danger
          onClick={() => {
            setDelText('')
            setDelError(null)
            setDelOpen(true)
          }}
          right={<span />}
        />
      </div>

      <Sheet open={delOpen} onClose={() => setDelOpen(false)} title={t('settings.deleteAccount')}>
        <p className="text-sm text-content-secondary mb-4">{t('settings.deleteAccountWarn')}</p>
        <label className="label">{t('settings.deleteAccountConfirm')}</label>
        <input
          className="input mb-3"
          value={delText}
          onChange={(e) => setDelText(e.target.value)}
          placeholder="EXCLUIR"
          autoCapitalize="characters"
        />
        {delError && (
          <div className="alert-error mb-3">
            {delError}
          </div>
        )}
        <button
          className="btn-danger w-full"
          disabled={delText.trim().toUpperCase() !== 'EXCLUIR' || deleting}
          onClick={deleteAccount}
        >
          {deleting ? <Spinner /> : <UserX size={18} />} {t('settings.deleteAccount')}
        </button>
      </Sheet>

      <div className="flex flex-col items-center gap-2 pb-4 text-content-muted">
        <Logo size="lg" />
        <p className="text-xs">{APP_NAME} • {APP_VERSION}</p>
        <SafeAreaDebug />
      </div>
    </div>
  )
}
