import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Eye,
  EyeOff,
  AudioLines,
  FileText,
  Sparkles,
  Search,
  Mail,
  Lock,
  ShieldCheck,
  Cloud,
  Download,
  Monitor,
  Smartphone,
  ChevronDown,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useT } from '../lib/i18n'
import { Logo } from '../components/Logo'
import { Spinner } from '../components/ui'
import { config } from '../lib/config'
import { setRememberMe } from '../lib/supabase'
import { WINDOWS_APP_DOWNLOAD_URL } from '../lib/windowsApp'
import { ANDROID_APK_DOWNLOAD_URL } from '../lib/androidApp'
import { APP_VERSION } from '../lib/version'

/** Os 4 pilares da referencia. */
const PILLARS = [
  { icon: <AudioLines size={20} />, k: 'login.p1' },
  { icon: <FileText size={20} />, k: 'login.p2' },
  { icon: <Sparkles size={20} />, k: 'login.p3' },
  { icon: <Search size={20} />, k: 'login.p4' },
]

const TRUST = [
  { icon: <ShieldCheck size={20} />, t: 'login.t1', d: 'login.t1d' },
  { icon: <Lock size={20} />, t: 'login.t2', d: 'login.t2d' },
  { icon: <Cloud size={20} />, t: 'login.t3', d: 'login.t3d' },
]

/** Fundo preto com brilho vermelho e arcos sutis (referencia). */
function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black">
      <div
        className="absolute -bottom-40 -left-40 h-[38rem] w-[38rem] rounded-full blur-3xl opacity-40"
        style={{ background: 'radial-gradient(circle, rgba(208,30,39,0.55), transparent 62%)' }}
      />
      <div
        className="absolute -top-56 -right-40 h-[42rem] w-[42rem] rounded-full blur-3xl opacity-25"
        style={{ background: 'radial-gradient(circle, rgba(208,30,39,0.4), transparent 65%)' }}
      />
      <div className="absolute -top-1/4 -right-1/4 h-[60rem] w-[60rem] rounded-full border border-white/[0.04]" />
      <div className="absolute -top-1/3 -right-1/3 h-[72rem] w-[72rem] rounded-full border border-white/[0.03]" />
    </div>
  )
}

const LAST_EMAIL_KEY = 'tailor.lastEmail'

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const t = useT()
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(LAST_EMAIL_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  // Ligado por padrao: se ja tinha um e-mail salvo, e porque o usuario ja escolheu "manter
  // conectado" antes -- comecar desmarcado apagaria essa preferencia sem ele pedir.
  const [keepSignedIn, setKeepSignedIn] = useState(true)

  // A tela de login tem MODO UNICO (escuro). Forca o tema enquanto ela existe e
  // devolve o tema do usuario ao sair. Por isso nao ha botao de light/dark aqui.
  useEffect(() => {
    const root = document.documentElement
    const wasDark = root.classList.contains('dark')
    root.classList.add('dark')
    return () => {
      if (!wasDark) root.classList.remove('dark')
    }
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      setRememberMe(keepSignedIn)
      try {
        if (keepSignedIn) localStorage.setItem(LAST_EMAIL_KEY, email.trim())
        else localStorage.removeItem(LAST_EMAIL_KEY)
      } catch {
        /* nao bloqueia o login por isso */
      }
      await signIn(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entrar.')
    } finally {
      setLoading(false)
    }
  }

  const field =
    'w-full rounded-xl bg-white/[0.04] border border-white/10 pl-11 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/50'

  return (
    <div className="min-h-[100dvh] flex flex-col safe-top text-white">
      <Backdrop />

      <header className="flex items-center justify-between gap-4 px-6 md:px-10 pb-6 shrink-0">
        {/* A tela e sempre escura, independente do tema do usuario: arte branca fixa. */}
        <Logo part="ana" heightClass="h-9 md:h-11" variant="dark" />
        <div className="flex items-center gap-3 md:gap-5">
          <Logo part="tailor" heightClass="h-5 md:h-6" variant="dark" />
          <div className="relative">
            <button
              onClick={() => setDownloadOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-2 text-sm text-white/85 hover:bg-white/10 transition-colors"
            >
              <Download size={15} />
              <span className="hidden sm:inline">{t('login.download')}</span>
              <ChevronDown size={13} className={`transition-transform ${downloadOpen ? 'rotate-180' : ''}`} />
            </button>
            {downloadOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDownloadOpen(false)} />
                <div className="absolute right-0 mt-2 w-60 z-20 bg-black border border-white/10 rounded-2xl shadow-float overflow-hidden py-1">
                  <a
                    href={WINDOWS_APP_DOWNLOAD_URL}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setDownloadOpen(false)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left text-white hover:bg-white/10"
                  >
                    <Monitor size={17} className="text-accent shrink-0" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium">
                        {t('login.downloadWindows')}
                        <span className="text-[10px] font-semibold text-white/60 border border-white/15 rounded-full px-1.5 py-0.5 shrink-0">
                          {APP_VERSION}
                        </span>
                      </span>
                      <span className="block text-xs text-white/50 mt-0.5">{t('login.downloadWindowsSub')}</span>
                    </span>
                  </a>
                  <a
                    href={ANDROID_APK_DOWNLOAD_URL}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setDownloadOpen(false)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left text-white hover:bg-white/10 border-t border-white/10"
                  >
                    <Smartphone size={17} className="text-accent shrink-0" />
                    <span>
                      <span className="block font-medium">{t('login.downloadAndroid')}</span>
                      <span className="block text-xs text-white/50 mt-0.5">{t('login.downloadAndroidSub')}</span>
                    </span>
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 md:px-10 pb-10">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 lg:items-center">
          {/* Marca. No mobile o titulo fica centralizado. */}
          <div className="text-center lg:text-left">
            <span className="inline-block rounded-xl border border-brand-solid/60 text-accent text-[11px] font-bold tracking-[0.18em] px-4 py-2">
              {t('login.badge')}
            </span>

            <h1 className="font-display text-4xl sm:text-5xl font-bold leading-tight mt-6">
              {t('login.h1a')}
              <br />
              {t('login.h1b')} <span className="text-accent">{t('login.h1c')}</span>
            </h1>

            <p className="text-white/70 mt-5 text-base sm:text-lg max-w-xl mx-auto lg:mx-0 leading-relaxed">
              {t('login.lead')}
            </p>

            <div className="grid grid-cols-4 gap-2 mt-9 max-w-xl mx-auto lg:mx-0">
              {PILLARS.map((p, i) => (
                <div key={p.k} className={`text-center px-1 ${i > 0 ? 'border-l border-white/10' : ''}`}>
                  <span className="grid place-items-center h-11 w-11 rounded-full bg-brand-solid/15 text-accent mx-auto mb-2">
                    {p.icon}
                  </span>
                  <p className="text-[11px] sm:text-xs text-white/80 leading-snug">{t(p.k)}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 max-w-md mx-auto lg:mx-0">
              <p className="text-sm font-medium">{t('login.audience')}</p>
            </div>
          </div>

          {/* Formulario: somente e-mail e senha (sem login social). */}
          <div className="w-full max-w-md mx-auto rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur px-6 py-7 sm:px-8">
            <h2 className="font-display text-2xl font-bold text-center">{t('login.cardTitle')}</h2>
            <p className="text-white/60 text-sm text-center mt-1 mb-6">{t('login.cardSub')}</p>

            {config.mockMode && (
              <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                <p className="font-medium">Modo demonstração ativo.</p>
                <p className="mt-1">
                  Este ambiente não está usando o Supabase real. Defina VITE_SUPABASE_URL e
                  VITE_SUPABASE_ANON_KEY no ambiente de deploy.
                </p>
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-1.5" htmlFor="email">
                  {t('login.email')}
                </label>
                <div className="relative">
                  <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    className={`${field} pr-4`}
                    placeholder={`nome@${config.allowedDomain}`}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-1.5" htmlFor="password">
                  {t('login.password')}
                </label>
                <div className="relative">
                  <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    id="password"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    className={`${field} pr-12`}
                    placeholder={t('login.yourPassword')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                    aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2.5 text-sm text-white/75 select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  onChange={(e) => setKeepSignedIn(e.target.checked)}
                  className="h-4 w-4 rounded border-white/30 bg-white/[0.04] accent-brand-solid"
                />
                {t('login.keepSignedIn')}
              </label>

              {error && (
                <div className="text-sm text-white bg-brand-solid/20 border border-brand-solid/50 rounded-xl px-4 py-3">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn w-full py-3 rounded-xl bg-brand-solid hover:opacity-90 text-white font-medium"
                disabled={loading}
              >
                {loading ? <Spinner /> : t('login.signin')}
              </button>
            </form>

            <div className="border-t border-white/10 mt-6 pt-5 text-center text-sm text-white/60">
              {t('login.newHere')}{' '}
              <Link to="/cadastro" className="text-accent font-medium hover:underline">
                {t('login.createAccount')}
              </Link>
            </div>

            {config.mockMode && (
              <div className="mt-5 text-xs text-white/50 bg-white/[0.04] border border-white/10 rounded-xl p-4">
                <p className="font-medium text-white/70 mb-1">Modo demonstração (sem backend)</p>
                <p>Admin: {config.adminEmail} / Tailor@007</p>
              </div>
            )}
          </div>
        </div>

        {/* Selos de confianca */}
        <div className="border-t border-white/10 mt-12 pt-7 grid gap-6 sm:grid-cols-3">
          {TRUST.map((x) => (
            <div key={x.t} className="flex items-start gap-3">
              <span className="text-white/50 shrink-0 mt-0.5">{x.icon}</span>
              <div>
                <p className="text-sm font-semibold">{t(x.t)}</p>
                <p className="text-xs text-white/50 mt-0.5 leading-snug">{t(x.d)}</p>
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center py-6 text-sm text-white/40 safe-bottom shrink-0">
        {/* Links publicos (abrem sem login): a Microsoft Store pede a URL da politica e o revisor
            nao tem conta. */}
        <nav className="flex items-center justify-center gap-3 mb-2 text-xs">
          <Link to="/privacidade" className="hover:text-accent transition-colors">
            {t('settings.privacy')}
          </Link>
          <span aria-hidden>·</span>
          <Link to="/termos" className="hover:text-accent transition-colors">
            {t('settings.terms')}
          </Link>
        </nav>
        A N A Technology by{' '}
        <a href="https://tailorexec.com.br" target="_blank" rel="noreferrer" className="hover:text-accent transition-colors">
          Tailorexec.com.br
        </a>
      </footer>
    </div>
  )
}
