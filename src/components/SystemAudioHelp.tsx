import { useState } from 'react'
import { ChevronDown, Headphones } from 'lucide-react'
import { isElectron } from '../lib/electron'

/**
 * Aviso de "estou gravando so a sua voz" com PASSO A PASSO para o proprio usuario resolver.
 *
 * Antes era uma frase ("confirme que a chamada esta tocando no PC") e o problema voltava: foram 26
 * avisos em 30 dias (ate 16/09/2026). A causa quase sempre e a saida de som: a chamada toca num
 * dispositivo que nao e o padrao do Windows, ou no celular, ou o app da reuniao esta mudo.
 */
export function SystemAudioHelp({ kind, onRetry }: { kind: 'missing' | 'silent'; onRetry: () => void }) {
  const [open, setOpen] = useState(kind === 'missing')
  const app = isElectron()

  const steps = app
    ? [
        <>
          Confira se você <b>ouve a outra pessoa pelo computador</b> (fone ou caixa de som do PC). Se a chamada estiver no
          celular, o ANA não tem como ouvir.
        </>,
        <>
          Clique no <b>ícone de som</b> da barra do Windows, ao lado do relógio, e veja qual saída está marcada. É por ela
          que o som da chamada precisa sair.
        </>,
        <>
          No Teams, Meet, Zoom ou WhatsApp, abra <b>Configurações → Áudio</b> e deixe o alto-falante em{' '}
          <b>“Padrão do sistema”</b> (ou no mesmo dispositivo do passo 2).
        </>,
        <>
          Veja se o volume da chamada não está no mudo e toque em <b>“Tentar captar o áudio do PC”</b>.
        </>,
      ]
    : [
        <>
          Toque em <b>“Adicionar áudio da reunião”</b>.
        </>,
        <>
          Na janela do navegador, abra <b>“Guia do Chrome”</b> e escolha a aba onde a reunião está aberta.
        </>,
        <>
          Deixe ligado <b>“Compartilhar também o áudio da guia”</b> e clique em <b>Compartilhar</b>.
        </>,
        <>
          Se a reunião estiver num aplicativo instalado (Teams, Zoom, WhatsApp), use o <b>ANA para Windows</b>: ele capta o
          som do computador inteiro.
        </>,
      ]

  const title =
    kind === 'missing'
      ? 'Estou gravando só a sua voz.'
      : app
        ? 'Não ouço o som do computador há mais de 30 segundos.'
        : 'Não ouço a reunião há mais de 30 segundos.'

  const lead =
    kind === 'missing'
      ? 'O som da reunião (a voz das outras pessoas) não está chegando. Sua voz continua sendo gravada.'
      : 'Se a reunião está em silêncio, está tudo certo. Se as pessoas estão falando, o som não está chegando — sua voz continua sendo gravada.'

  return (
    <div className="alert-error text-sm mt-3 max-w-sm text-left">
      <p>
        <span className="font-medium">{title}</span> {lead}
      </p>

      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline"
        aria-expanded={open}
      >
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? 'Ocultar passo a passo' : 'Como resolver'}
      </button>

      {open && (
        <ol className="mt-2 space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2 leading-snug">
              <span className="grid place-items-center h-5 w-5 rounded-full bg-surface-card border border-surface-border text-[11px] font-semibold shrink-0 mt-px">
                {i + 1}
              </span>
              <span className="min-w-0">{s}</span>
            </li>
          ))}
        </ol>
      )}

      <button className={`${kind === 'missing' ? 'btn-primary' : 'btn-outline'} w-full mt-3`} onClick={onRetry}>
        <Headphones size={16} /> {app ? 'Tentar captar o áudio do PC' : 'Adicionar áudio da reunião'}
      </button>
    </div>
  )
}
