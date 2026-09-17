import { useEffect, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { getAppSettings, updateAppSettings } from '../lib/appSettings'
import { useAppSettings } from '../app/SettingsProvider'
import type { AppSettings } from '../lib/types'
import { AutoTextarea, Spinner } from '../components/ui'
import { logSilentError } from '../lib/auditLog'
import { useToast } from '../components/Toast'

/**
 * Formulario do modo manutencao. Desde 17/09/2026 abre numa folha a partir do cartao
 * "Modo manutenção" do painel (antes ocupava meia tela fixa no topo do /admin).
 */
export function MaintenanceForm({ onDone }: { onDone?: () => void }) {
  const { refresh } = useAppSettings()
  const toast = useToast()
  const [s, setS] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    getAppSettings().then(setS)
  }, [])

  if (!s) {
    return (
      <div className="grid place-items-center py-10">
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
        maintenance_enabled: enabled,
        maintenance_message: s.maintenance_message,
        maintenance_eta: s.maintenance_eta,
      })
      setS(next)
      await refresh()
      setOk(true)
      toast(enabled ? 'Manutenção publicada' : 'Manutenção encerrada')
      setTimeout(() => {
        setOk(false)
        onDone?.()
      }, 900)
    } catch (err) {
      logSilentError('client:MaintenanceForm.save', err)
      toast('Não foi possível salvar a manutenção', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-xl px-3 py-2 mb-4 text-sm ${
          s.maintenance_enabled ? 'bg-accent/10 text-accent' : 'bg-surface-elevated text-content-secondary'
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${s.maintenance_enabled ? 'bg-brand-solid animate-pulse' : 'bg-emerald-500'}`} />
        {s.maintenance_enabled ? 'Ativo: o app está bloqueado para os usuários' : 'Desligado: o app está funcionando normalmente'}
      </div>

      <label className="label">Mensagem para os usuários</label>
      <AutoTextarea
        minRows={3}
        maxRows={8}
        className="mb-3"
        placeholder="Estamos aprimorando a plataforma."
        value={s.maintenance_message}
        onChange={(e) => set({ maintenance_message: e.target.value })}
      />

      <label className="label">Previsão de retorno (opcional)</label>
      <input
        className="input mb-4"
        placeholder="Ex.: hoje às 18h"
        value={s.maintenance_eta}
        onChange={(e) => set({ maintenance_eta: e.target.value })}
      />

      {s.maintenance_enabled ? (
        <button className="btn-outline w-full text-accent" onClick={() => save(false)} disabled={saving}>
          {saving ? <Spinner /> : ok ? <Check size={18} /> : null} Encerrar manutenção
        </button>
      ) : (
        <>
          <p className="flex items-start gap-2 text-xs text-content-muted mb-3">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-500" />
            Ao publicar, o app fica bloqueado para todos. Você, como administrador, continua com acesso.
          </p>
          <button className="btn-primary w-full" onClick={() => save(true)} disabled={saving}>
            {saving ? <Spinner /> : ok ? <Check size={18} /> : null}
            {ok ? 'Publicado' : 'Publicar manutenção'}
          </button>
        </>
      )}
    </div>
  )
}
