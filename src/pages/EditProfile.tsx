import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Instagram, Linkedin, Lock, Phone, Save } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { Avatar, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { uploadAvatar } from '../lib/avatar'
import { useT } from '../lib/i18n'
import { logSilentError } from '../lib/auditLog'

/** Aceita URL completa ou so o handle; guarda sempre a URL canonica. */
function normalizeLinkedin(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  const m = v.match(/linkedin\.com\/(in|company)\/([^/?#\s]+)/i)
  if (m) return `https://www.linkedin.com/${m[1].toLowerCase()}/${m[2]}`
  if (/^[a-z0-9._-]{3,100}$/i.test(v)) return `https://www.linkedin.com/in/${v}`
  return null // texto que nao parece perfil nenhum
}

/** Guarda so o handle, sem @ e sem URL. */
function normalizeInstagram(raw: string): string | null {
  const v = raw.trim().replace(/^@/, '')
  if (!v) return null
  const m = v.match(/instagram\.com\/([^/?#\s]+)/i)
  return (m ? m[1] : v).slice(0, 40)
}

export function EditProfile() {
  const { profile, updateProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const t = useT()
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [first, setFirst] = useState(profile?.first_name ?? '')
  const [last, setLast] = useState(profile?.last_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [instagram, setInstagram] = useState(profile?.instagram ?? '')
  const [linkedin, setLinkedin] = useState(profile?.linkedin ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  if (!profile) return null

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Cada envio vira um arquivo novo no armazenamento: um de cada vez.
    if (!file || !profile || uploading) return
    setUploading(true)
    try {
      const url = await uploadAvatar(profile.id, file)
      if (url) await updateProfile({ avatar_url: url })
    } catch (err) {
      logSilentError('client:EditProfile.onPhoto', err)
      toast(t('common.error'), 'error')
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    const li = normalizeLinkedin(linkedin)
    if (linkedin.trim() && !li) {
      toast(t('profile.invalidLinkedin'), 'error')
      return
    }
    setSaving(true)
    try {
      await updateProfile({
        first_name: first.trim(),
        last_name: last.trim(),
        phone: phone.trim(),
        instagram: normalizeInstagram(instagram),
        linkedin: li,
      })
      toast(t('profile.saved'))
      navigate('/config')
    } catch (err) {
      logSilentError('client:EditProfile.save', err)
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-5 safe-top pb-12 max-w-2xl mx-auto">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/config')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-display text-2xl font-bold">{t('settings.editProfile')}</h1>
      </header>

      <div className="card p-5 flex items-center gap-4 mb-6">
        <button onClick={() => fileRef.current?.click()} className="relative shrink-0" aria-label={t('profile.photo')}>
          <Avatar first={profile.first_name} last={profile.last_name} size={64} url={profile.avatar_url} />
          <span className="absolute -bottom-1 -right-1 grid place-items-center h-7 w-7 rounded-full bg-brand-solid text-white border-2 border-surface-card">
            {uploading ? <Spinner size={13} /> : <Camera size={13} />}
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
        <div className="min-w-0">
          <p className="font-medium">{t('profile.photo')}</p>
          <button onClick={() => fileRef.current?.click()} className="text-sm text-accent">
            {t('settings.changePhoto')}
          </button>
        </div>
      </div>

      <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('profile.identity')}</p>
      <div className="card p-4 space-y-3 mb-6">
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="label">{t('settings.firstName')}</label>
            <input className="input w-full min-w-0" value={first} onChange={(e) => setFirst(e.target.value)} />
          </div>
          <div className="min-w-0">
            <label className="label">{t('settings.lastName')}</label>
            <input className="input w-full min-w-0" value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">{t('profile.phone')}</label>
          <div className="relative">
            <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              type="tel"
              inputMode="tel"
              maxLength={30}
              className="input w-full min-w-0 pl-9"
              placeholder="+55 11 90000-0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <p className="text-xs text-content-muted mt-1">{t('profile.phoneHint')}</p>
        </div>

        {/* O e-mail e a identidade de login (e o dominio e travado por trigger no banco). */}
        <div>
          <label className="label">{t('profile.email')}</label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              className="input w-full min-w-0 pl-9 opacity-60 cursor-not-allowed"
              value={profile.email}
              readOnly
              disabled
            />
          </div>
          <p className="text-xs text-content-muted mt-1">{t('profile.emailLocked')}</p>
        </div>
      </div>

      <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">{t('profile.social')}</p>
      <div className="card p-4 space-y-3 mb-6">
        <div>
          <label className="label">{t('profile.instagram')}</label>
          <div className="relative">
            <Instagram size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              className="input w-full min-w-0 pl-9"
              placeholder="@seuperfil"
              maxLength={40}
              autoCapitalize="off"
              autoCorrect="off"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">{t('profile.linkedin')}</label>
          <div className="relative">
            <Linkedin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              className="input w-full min-w-0 pl-9"
              placeholder={t('profile.linkedinPlaceholder')}
              maxLength={200}
              autoCapitalize="off"
              autoCorrect="off"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
            />
          </div>
        </div>
      </div>

      <button className="btn-primary w-full" onClick={save} disabled={saving || !first.trim()}>
        {saving ? <Spinner /> : <Save size={18} />} {t('common.save')}
      </button>
    </div>
  )
}
