import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Share,
  SquarePlus,
  Download,
  CheckCircle2,
  Smartphone,
  ArrowLeft,
  Monitor,
  Apple,
  ChevronDown,
  Wifi,
  Maximize2,
  RefreshCw,
} from 'lucide-react'
import { Logo } from '../components/Logo'
import { useToast } from '../components/Toast'
import { WINDOWS_APP_DOWNLOAD_URL, WINDOWS_FROM_STORE } from '../lib/windowsApp'
import { ehCelular } from '../lib/ondeEstou'
import {
  canInstallNow,
  isAndroidDevice,
  isIOSDevice,
  isStandaloneDisplay,
  onInstallPromptChange,
  triggerInstall,
} from '../lib/pwaInstall'

const ENDERECO = 'ana.nectarmd.com.br/instalar'

/** Chrome/Edge no Android reportam corretamente; Safari/Firefox no iOS nunca tem esse UA. */
function isChromiumBrowser(): boolean {
  const ua = navigator.userAgent || ''
  return /Chrome|Chromium|Edg\//i.test(ua) && !/Firefox\//i.test(ua)
}

/** No iPhone, so o Safari instala. Chrome e Firefox de iPhone usam CriOS/FxiOS no user agent. */
function ehSafariDeIPhone(): boolean {
  const ua = navigator.userAgent || ''
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)
}

/** Passo numerado com icone -- reaproveitado pelos dois sistemas. */
function Passo({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid place-items-center h-7 w-7 rounded-full bg-brand-solid text-white text-xs font-bold shrink-0">
        {n}
      </span>
      <div className="flex items-start gap-2 pt-0.5">
        <span className="text-accent shrink-0 mt-0.5">{icon}</span>
        <p className="text-sm text-content-secondary leading-relaxed">{children}</p>
      </div>
    </li>
  )
}

/** Bloco que abre e fecha -- usado para o aparelho que a pessoa NAO esta usando agora. */
function Sanfona({
  titulo,
  icone,
  aberta,
  onToggle,
  children,
}: {
  titulo: string
  icone: React.ReactNode
  aberta: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="card overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={aberta}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-elevated transition-colors"
      >
        <span className="text-accent shrink-0">{icone}</span>
        <span className="flex-1 min-w-0 text-sm font-medium">{titulo}</span>
        <ChevronDown size={16} className={`text-content-muted shrink-0 transition-transform ${aberta ? 'rotate-180' : ''}`} />
      </button>
      {aberta && <div className="px-4 pb-4 pt-1 border-t border-surface-border">{children}</div>}
    </div>
  )
}

function PassosIPhone() {
  return (
    <>
      <ol className="space-y-3.5 mt-3">
        <Passo n={1} icon={<Share size={16} />}>
          Abra este endereço no <span className="font-medium text-content-primary">Safari</span> e toque no
          ícone de <span className="font-medium text-content-primary">Compartilhar</span> (o quadrado com uma
          seta para cima, na barra de baixo).
        </Passo>
        <Passo n={2} icon={<SquarePlus size={16} />}>
          Role a lista e toque em{' '}
          <span className="font-medium text-content-primary">“Adicionar à Tela de Início”</span>.
        </Passo>
        <Passo n={3} icon={<CheckCircle2 size={16} />}>
          Toque em <span className="font-medium text-content-primary">Adicionar</span>. O ícone do ANA aparece
          na tela de início, como qualquer outro app.
        </Passo>
      </ol>
      <p className="text-xs text-content-muted mt-4 leading-relaxed">
        No iPhone e no iPad isso só funciona pelo <span className="font-medium text-content-primary">Safari</span> —
        é uma regra da Apple. Se você abriu no Chrome, no Firefox ou dentro do Instagram/WhatsApp, copie o
        endereço e cole no Safari.
      </p>
    </>
  )
}

function PassosAndroid() {
  return (
    <>
      <ol className="space-y-3.5 mt-3">
        <Passo n={1} icon={<Smartphone size={16} />}>
          Toque no menu do navegador — os três pontinhos{' '}
          <span className="font-medium text-content-primary">⋮</span> no canto da tela.
        </Passo>
        <Passo n={2} icon={<SquarePlus size={16} />}>
          Toque em <span className="font-medium text-content-primary">“Instalar aplicativo”</span> ou{' '}
          <span className="font-medium text-content-primary">“Adicionar à tela inicial”</span> — o nome muda
          conforme o navegador.
        </Passo>
        <Passo n={3} icon={<CheckCircle2 size={16} />}>
          Confirme. Pronto: o ANA vira um ícone na tela inicial.
        </Passo>
      </ol>
      <p className="text-xs text-content-muted mt-4 leading-relaxed">
        Funciona no Chrome, no Edge e no navegador da Samsung. No Firefox o caminho é{' '}
        <span className="font-medium text-content-primary">⋮ → Adicionar à tela inicial</span>. Se você abriu
        este link dentro do Instagram ou do WhatsApp, toque em “abrir no navegador” primeiro.
      </p>
    </>
  )
}

export function InstallApp() {
  const toast = useToast()
  const [canInstall, setCanInstall] = useState(canInstallNow())
  const [installed, setInstalled] = useState(isStandaloneDisplay())
  const [installing, setInstalling] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [aberta, setAberta] = useState<'ios' | 'android' | null>(null)
  const ios = isIOSDevice()
  const android = isAndroidDevice()
  const celular = ehCelular()
  const chromium = isChromiumBrowser()

  useEffect(() => onInstallPromptChange(() => setCanInstall(canInstallNow())), [])

  async function instalarAgora() {
    setInstalling(true)
    try {
      const outcome = await triggerInstall()
      if (outcome === 'accepted') {
        setInstalled(true)
        toast('App instalado!')
      } else if (outcome === 'unavailable') {
        toast('Abra este link no Chrome do Android para instalar automaticamente.', 'error')
      }
    } finally {
      setInstalling(false)
    }
  }

  async function copiarEndereco() {
    try {
      await navigator.clipboard.writeText(`https://${ENDERECO}`)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      /* area de transferencia bloqueada: o endereco continua na tela para digitar */
    }
  }

  return (
    <div className="min-h-dvh px-5 safe-top safe-bottom pb-12">
      <header className="flex items-center gap-3 mb-8 pt-2">
        <Link
          to="/"
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </Link>
        <Logo size="md" />
      </header>

      <div className="max-w-md mx-auto">
        <div className="grid place-items-center h-16 w-16 rounded-2xl bg-brand-solid text-white mx-auto mb-5">
          <Smartphone size={30} />
        </div>
        <h1 className="font-display text-2xl font-bold text-center mb-2">O ANA no seu celular</h1>
        <p className="text-content-secondary text-center text-sm mb-6 leading-relaxed">
          No celular o ANA não vem de loja de aplicativos: você o instala direto do navegador, em poucos
          toques. É o mesmo ANA do site, só que com ícone próprio e sem a barra do navegador em volta.
        </p>

        {/* O que muda depois de instalar -- e o que responde "por que eu faria isso?" */}
        <div className="card p-4 mb-5">
          <ul className="space-y-2.5">
            <li className="flex items-start gap-2.5 text-sm text-content-secondary">
              <Smartphone size={16} className="text-accent shrink-0 mt-0.5" />
              <span>Ícone na tela de início, junto dos seus outros apps.</span>
            </li>
            <li className="flex items-start gap-2.5 text-sm text-content-secondary">
              <Maximize2 size={16} className="text-accent shrink-0 mt-0.5" />
              <span>Abre em tela cheia, sem a barra de endereço ocupando espaço.</span>
            </li>
            <li className="flex items-start gap-2.5 text-sm text-content-secondary">
              <RefreshCw size={16} className="text-accent shrink-0 mt-0.5" />
              <span>Sempre na versão mais nova — não existe atualização para instalar.</span>
            </li>
            <li className="flex items-start gap-2.5 text-sm text-content-secondary">
              <Wifi size={16} className="text-accent shrink-0 mt-0.5" />
              <span>
                Precisa de internet para gravar e transcrever, como no site. E, no iPhone, mantenha o ANA na
                tela enquanto grava: o iOS tira o microfone de qualquer app que sai da frente.
              </span>
            </li>
          </ul>
        </div>

        {/* Caminho principal: o do aparelho em que a pessoa esta agora. */}
        {installed ? (
          <div className="card p-6 text-center">
            <CheckCircle2 size={32} className="text-accent mx-auto mb-3" />
            <p className="font-display font-semibold mb-1">Já está instalado</p>
            <p className="text-sm text-content-muted">Você está usando o ANA como app neste aparelho.</p>
          </div>
        ) : ios ? (
          <div className="card p-5">
            <p className="text-sm font-medium flex items-center gap-2">
              <Apple size={16} className="text-accent" /> No seu iPhone/iPad, em 3 toques
            </p>
            <PassosIPhone />
            {!ehSafariDeIPhone() && (
              <div className="mt-4 rounded-xl bg-accent/10 px-3 py-2.5">
                <p className="text-xs text-accent leading-relaxed">
                  Você não está no Safari. Copie o endereço e abra lá:
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  <code className="text-xs font-medium break-all text-content-primary">{ENDERECO}</code>
                  <button onClick={copiarEndereco} className="btn-ghost h-7 px-2 text-[11px] shrink-0 ml-auto">
                    {copiado ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : celular ? (
          <div className="card p-5">
            <p className="text-sm font-medium flex items-center gap-2">
              <Smartphone size={16} className="text-accent" /> No seu celular
            </p>
            {canInstall ? (
              <>
                <p className="text-sm text-content-secondary mt-2 mb-4">
                  Seu navegador instala o ANA com um toque:
                </p>
                <button className="btn-primary w-full" onClick={instalarAgora} disabled={installing}>
                  <Download size={18} /> {installing ? 'Instalando...' : 'Instalar agora'}
                </button>
                <p className="text-xs text-content-muted mt-3">
                  Se o botão não fizer nada, dá para instalar pelo menu do navegador — veja abaixo.
                </p>
              </>
            ) : (
              <>
                {android && !chromium && (
                  <p className="text-xs text-content-muted mt-2">
                    No Chrome do Android aparece um botão de instalar automático. No seu navegador, o caminho é
                    pelo menu:
                  </p>
                )}
                <PassosAndroid />
              </>
            )}
          </div>
        ) : (
          /* Computador: instalar na tela de inicio e coisa de celular -- aqui o certo e o app do Windows. */
          <div className="card p-5">
            <p className="text-sm font-medium flex items-center gap-2">
              <Monitor size={16} className="text-accent" /> Você está no computador
            </p>
            <p className="text-sm text-content-secondary mt-2 leading-relaxed">
              Esta página é para instalar o ANA no <span className="font-medium text-content-primary">celular</span>.
              No computador, o certo é o app do Windows — é ele que grava reuniões com o áudio do próprio PC.
            </p>
            <a
              href={WINDOWS_APP_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-primary w-full mt-4"
            >
              <Monitor size={18} /> {WINDOWS_FROM_STORE ? 'Abrir na Microsoft Store' : 'Baixar o app do Windows'}
            </a>
            <div className="mt-4 rounded-xl bg-surface-elevated border border-surface-border px-3 py-2.5">
              <p className="text-xs text-content-muted">Para instalar no celular, abra este endereço no telefone:</p>
              <div className="flex items-center gap-2 mt-1.5">
                <code className="text-sm font-medium break-all">{ENDERECO}</code>
                <button onClick={copiarEndereco} className="btn-ghost h-7 px-2 text-[11px] shrink-0 ml-auto">
                  {copiado ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Os outros aparelhos ficam aqui, fechados: quem precisa ensinar alguem encontra tudo na
            mesma pagina, sem virar um muro de texto para quem so quer instalar no proprio. */}
        {!installed && (
          <div className="mt-6">
            <p className="text-xs uppercase tracking-wide text-content-muted mb-2 px-1">Em outro aparelho</p>
            <div className="space-y-2">
              {!ios && (
                <Sanfona
                  titulo="iPhone ou iPad (pelo Safari)"
                  icone={<Apple size={16} />}
                  aberta={aberta === 'ios'}
                  onToggle={() => setAberta(aberta === 'ios' ? null : 'ios')}
                >
                  <PassosIPhone />
                </Sanfona>
              )}
              {!android && (
                <Sanfona
                  titulo="Android (Chrome, Edge, Samsung, Firefox)"
                  icone={<Smartphone size={16} />}
                  aberta={aberta === 'android'}
                  onToggle={() => setAberta(aberta === 'android' ? null : 'android')}
                >
                  <PassosAndroid />
                </Sanfona>
              )}
              {celular && (
                <div className="card px-4 py-3 flex items-start gap-3">
                  <Monitor size={16} className="text-accent shrink-0 mt-0.5" />
                  <p className="text-sm text-content-secondary leading-relaxed">
                    <span className="font-medium text-content-primary">No computador</span> existe o app do
                    Windows, que grava reuniões com o áudio do próprio PC. Abra{' '}
                    <span className="font-medium text-content-primary">{ENDERECO}</span> no computador para
                    baixá-lo.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-content-muted text-center mt-6">
          Depois de instalado, abra o ANA pelo ícone — o login continua o mesmo.
        </p>
      </div>
    </div>
  )
}
