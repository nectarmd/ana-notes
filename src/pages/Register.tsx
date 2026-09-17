import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Check } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { Logo } from '../components/Logo'
import { ThemeToggle } from '../components/ThemeToggle'
import { Spinner } from '../components/ui'
import { config, isAllowedDomain } from '../lib/config'
import { useT } from '../lib/i18n'

const COUNTRY_CODES = [
  { code: '+55', label: 'BR +55' },
  { code: '+1', label: 'US +1' },
  { code: '+351', label: 'PT +351' },
  { code: '+44', label: 'UK +44' },
  { code: '+34', label: 'ES +34' },
  { code: '+54', label: 'AR +54' },
]

export function Register() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const t = useT()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [ddi, setDdi] = useState('+55')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const emailOk = email.length === 0 || isAllowedDomain(email)
  const passwordsMatch = confirm.length === 0 || password === confirm
  const strongEnough = password.length >= 6

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)

    if (!isAllowedDomain(email)) {
      setError(t('reg.errDomain').replace('{d}', config.allowedDomain))
      return
    }
    if (password !== confirm) {
      setError(t('reg.mismatch'))
      return
    }
    if (!strongEnough) {
      setError(t('reg.errWeak'))
      return
    }

    setLoading(true)
    try {
      await signUp({
        first_name: firstName,
        last_name: lastName,
        email,
        phone: `${ddi} ${phone}`.trim(),
        password,
      })
      navigate('/', { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('reg.errFail')
      // In Supabase mode signUp may require email confirmation.
      if (/confirmar|verifique/i.test(msg)) setInfo(msg)
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-surface-bg safe-top">
      <header className="flex items-center justify-between px-6 pt-6">
        <Logo size="md" />
        <ThemeToggle />
      </header>

      <div className="flex-1 flex flex-col justify-center px-6 py-8 max-w-md w-full mx-auto">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold">{t('reg.title')}</h1>
          <p className="text-content-secondary mt-2">{t('reg.subtitleFull').replace('{d}', config.allowedDomain)}</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="first">{t('reg.firstName')}</label>
              <input id="first" className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="last">{t('reg.lastName')}</label>
              <input id="last" className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="email">{t('reg.email')}</label>
            <input
              id="email"
              type="email"
              className={`input ${!emailOk ? 'border-brand-solid focus:ring-brand-500/40' : ''}`}
              placeholder={`nome@${config.allowedDomain}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {!emailOk && (
              <p className="text-xs text-accent mt-1">{t('reg.emailMust').replace('{d}', config.allowedDomain)}</p>
            )}
          </div>

          <div>
            <label className="label" htmlFor="phone">{t('reg.phoneLabel')}</label>
            <div className="flex gap-2">
              <select
                aria-label="Código internacional"
                className="input w-28 shrink-0"
                value={ddi}
                onChange={(e) => setDdi(e.target.value)}
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
              <input
                id="phone"
                type="tel"
                className="input"
                placeholder="11 90000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="password">{t('reg.password')}</label>
            <div className="relative">
              <input
                id="password"
                type={show ? 'text' : 'password'}
                className="input pr-12"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted hover:text-content-primary"
                aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="confirm">{t('reg.confirm')}</label>
            <div className="relative">
              <input
                id="confirm"
                type={show ? 'text' : 'password'}
                className={`input pr-12 ${!passwordsMatch ? 'border-brand-solid focus:ring-brand-500/40' : ''}`}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {passwordsMatch && confirm.length > 0 && (
                <Check size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500" />
              )}
            </div>
            {!passwordsMatch && <p className="text-xs text-accent mt-1">{t('reg.mismatch')}</p>}
          </div>

          {error && (
            <div className="alert-error">
              {error}
            </div>
          )}
          {info && (
            <div className="text-sm text-green-500 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
              {info}
            </div>
          )}

          <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
            {loading ? <Spinner /> : t('reg.create')}
          </button>
        </form>

        <p className="text-center text-content-secondary mt-6">
          {t('reg.have')}{' '}
          <Link to="/login" className="text-accent font-medium hover:underline">
            {t('reg.signin')}
          </Link>
        </p>
      </div>
    </div>
  )
}
