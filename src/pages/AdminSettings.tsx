import { useEffect, useState } from 'react'
import { Wrench, Check } from 'lucide-react'
import { getAppSettings, updateAppSettings } from '../lib/appSettings'
import { useAppSettings } from '../app/SettingsProvider'
import type { AppSettings } from '../lib/types'
import { Spinner } from '../components/ui'

export function AdminSettings() {
  const { refresh } = useAppSettings()
  const [s, setS] = useState<AppSettings | null>(null)
  const [savingMaint, setSavingMaint] = useState(false)
  const [okMaint, setOkMaint] = useState(false)

  useEffect(() => {
    getAppSettings().then(setS)
  }, [])

  if (!s) return null
  const set = (patch: Partial<AppSettings>) => setS({ ...s, ...patch })

  async function saveMaintenance(enabled: boolean) {
    if (!s) return
    setSavingMaint(true)
    try {
      const next = await updateAppSettings({
        maintenance_enabled: enabled,
        maintenance_message: s.maintenance_message,
        maintenance_eta: s.maintenance_eta,
      })
      setS(next)
      await refresh()
      setOkMaint(true)
      setTimeout(() => setOkMaint(false), 1800)
    } finally {
      setSavingMaint(false)
    }
  }

  return (
    // Sem margem/largura propria: o layout (lado a lado com os KPIs) e decidido por quem chama.
    <div className="h-full">
      {/* Manutencao. Faixa de avisos foi pra /admin/dicas, junto com as Dicas. */}
      <div className="card p-5 h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 font-display font-semibold">
            <Wrench size={18} className="text-accent" /> Modo manutencao
          </h3>
          {s.maintenance_enabled && (
            <span className="text-[10px] uppercase tracking-wide bg-brand-solid text-white px-2 py-0.5 rounded-full">
              ativo
            </span>
          )}
        </div>

        <label className="label">Mensagem de manutencao</label>
        <textarea
          className="input min-h-[80px] resize-none mb-3"
          placeholder="Estamos aprimorando a plataforma."
          value={s.maintenance_message}
          onChange={(e) => set({ maintenance_message: e.target.value })}
        />

        <label className="label">Previsao de retorno (opcional)</label>
        <input
          className="input mb-4"
          placeholder="Ex: hoje as 18h"
          value={s.maintenance_eta}
          onChange={(e) => set({ maintenance_eta: e.target.value })}
        />

        {s.maintenance_enabled ? (
          <button className="btn-outline w-full text-accent" onClick={() => saveMaintenance(false)} disabled={savingMaint}>
            {savingMaint ? <Spinner /> : null} Remover manutencao
          </button>
        ) : (
          <>
            <div className="alert-error text-xs mb-3">
              Ao publicar, o app fica bloqueado para todos (você, como admin, continua com acesso).
            </div>
            <button className="btn-primary w-full" onClick={() => saveMaintenance(true)} disabled={savingMaint}>
              {savingMaint ? <Spinner /> : okMaint ? <Check size={18} /> : null}
              {okMaint ? 'Publicado' : 'Publicar manutencao'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
