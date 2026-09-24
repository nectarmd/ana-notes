import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AlertTriangle, Copy, Download } from 'lucide-react'
import { isElectron } from '../lib/electron'
import { isOlderVersion, WINDOWS_MIN_BUILD } from '../lib/version'
import { WINDOWS_INSTALLER_URL } from '../lib/windowsApp'
import { useT } from '../lib/i18n'

const SNOOZE_KEY = 'tailor.updateWallSnooze'
const PAGINA_INSTALAR = 'ana.nectarmd.com.br/instalar'

/**
 * Parede de atualizacao do app Windows (23/09/2026).
 *
 * Instaladores abaixo da 0.18.26 NAO se atualizam sozinhos -- e metade da equipe estava neles
 * (Larissa e Giovana na 0.18.15, de agosto). Um aviso discreto nao resolveu em um mes.
 *
 * Onde ela NAO aparece, de proposito:
 *  - no navegador e no PWA (nao ha o que instalar);
 *  - na copia da Microsoft Store (a Loja atualiza sozinha);
 *  - quando a versao do instalador e desconhecida (nao se bloqueia ninguem por duvida);
 *  - na tela de gravacao -- ninguem perde uma reuniao em andamento por causa de um aviso.
 *
 * E ela sempre tem saida ("Adiar por hoje"): travar quem nao consegue instalar AGORA seria
 * trocar um problema por outro pior, deixar a pessoa sem gravar a reuniao das proximas horas.
 *
 * O botao de baixar usa window.open, que so abre o navegador a partir da 0.20.0 -- justamente
 * quem esta bloqueado aqui pode nao ver nada acontecer. Por isso a tela tambem mostra o endereco
 * para digitar e um botao de copiar.
 */
export function UpdateWall() {
  const t = useT()
  const location = useLocation()
  const [copiado, setCopiado] = useState(false)
  const [adiado, setAdiado] = useState(() => {
    try {
      return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now()
    } catch {
      return false
    }
  })

  if (!isElectron()) return null
  const bridge = window.anaElectron!
  if (bridge.isStoreBuild) return null
  const versao = bridge.appVersion
  if (!versao || !isOlderVersion(versao, WINDOWS_MIN_BUILD)) return null
  if (adiado) return null
  if (location.pathname.startsWith('/capturar')) return null

  function adiar() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + 24 * 60 * 60 * 1000))
    } catch {
      /* sem localStorage: adia so nesta sessao */
    }
    setAdiado(true)
  }

  async function copiarEndereco() {
    try {
      await navigator.clipboard.writeText(`https://${PAGINA_INSTALAR}`)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      /* area de transferencia bloqueada: o endereco continua na tela para digitar */
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-5 backdrop-blur-sm">
      <div className="card w-full max-w-lg p-6 text-center">
        <span className="grid place-items-center h-14 w-14 rounded-2xl bg-accent/10 text-accent mx-auto mb-4">
          <AlertTriangle size={26} />
        </span>
        <h2 className="font-display text-xl font-bold">{t('update.wallTitle')}</h2>
        <p className="text-sm text-content-secondary mt-2 leading-relaxed">
          {t('update.wallBody').replace('{v}', versao)}
        </p>

        <button
          onClick={() => window.open(WINDOWS_INSTALLER_URL, '_blank')}
          className="btn-primary w-full mt-5 py-2.5"
        >
          <Download size={18} /> {t('update.wallCta')}
        </button>

        <div className="mt-4 rounded-xl bg-surface-elevated border border-surface-border px-4 py-3 text-left">
          <p className="text-xs text-content-muted">{t('update.wallFallback')}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <code className="text-sm font-medium break-all">{PAGINA_INSTALAR}</code>
            <button
              onClick={copiarEndereco}
              className="btn-ghost h-8 px-2 text-xs shrink-0 ml-auto"
              aria-label={t('update.wallCopy')}
            >
              <Copy size={14} /> {copiado ? t('update.wallCopied') : t('update.wallCopy')}
            </button>
          </div>
        </div>

        <button onClick={adiar} className="mt-4 text-xs text-content-muted hover:text-content-primary">
          {t('update.wallSnooze')}
        </button>
      </div>
    </div>
  )
}
