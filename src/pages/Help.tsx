import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  FolderKanban,
  LifeBuoy,
  Mic,
  Monitor,
  Search,
  SearchX,
  Share2,
  ShieldCheck,
} from 'lucide-react'
import { useI18n } from '../lib/i18n'
import { AnaIcon } from '../components/AnaIcon'
import { HelpAssistant } from './HelpAssistant'

type Item = { q: string; a: string }
type Category = { id: string; title: string; items: Item[] }
type Faq = {
  title: string
  intro: string
  search: string
  noResults: string
  noResultsSub: string
  stillTitle: string
  stillSub: string
  askAna: string
  support: string
  categories: Category[]
}

const ICONS: Record<string, ReactNode> = {
  record: <Mic size={16} />,
  organize: <FolderKanban size={16} />,
  share: <Share2 size={16} />,
  data: <ShieldCheck size={16} />,
  windows: <Monitor size={16} />,
}

/**
 * Conteudo revisado em 17/09/2026 contra o codigo: rotulos de menu iguais aos da tela, prazos
 * iguais aos da limpeza automatica (retention-cleanup) e sem prometer o que o app nao faz.
 */
const FAQ: Record<'pt' | 'en' | 'es', Faq> = {
  pt: {
    title: 'Central de ajuda',
    intro: 'Respostas rápidas sobre como usar o ANA by Tailor.',
    search: 'Buscar na ajuda (ex.: pasta, áudio, Windows)',
    noResults: 'Nada encontrado',
    noResultsSub: 'Tente outra palavra ou pergunte direto para a ANA.',
    stillTitle: 'Não encontrou o que procurava?',
    stillSub: 'A ANA responde na hora. Se for um problema, abra um chamado: a resposta chega no sininho.',
    askAna: 'Perguntar à ANA',
    support: 'Falar com o suporte',
    categories: [
      {
        id: 'record',
        title: 'Gravar e criar notas',
        items: [
          {
            q: 'Como crio uma nota?',
            a: 'Toque no microfone no centro da barra inferior (no computador, em "Nova Gravação" no menu lateral) e escolha: gravar, enviar áudio, enviar vídeo, PDF/arquivo/texto ou link da web. A transcrição, o resumo e os itens de ação são gerados automaticamente.',
          },
          {
            q: 'Como gravo uma reunião do computador?',
            a: 'No app ANA para Windows, a gravação capta o som do computador (Teams, Zoom, Meet, WhatsApp) e o seu microfone, inclusive com fone de ouvido. O atalho Ctrl+Shift+G começa a gravar na hora. No navegador (Chrome ou Edge), escolha a aba da reunião e deixe marcado "Compartilhar também o áudio da guia".',
          },
          {
            q: 'Posso importar PDF, DOCX ou um link?',
            a: 'Sim. Em "PDF, arquivo ou texto", o texto de PDFs e DOCX é extraído ao processar. Em "Link da web", a IA abre a página, pega o conteúdo principal e gera o resumo.',
          },
          {
            q: 'Título, tema e contexto são obrigatórios?',
            a: 'Não, todos são opcionais. Tema e contexto só ajudam a IA a analisar no formato certo (entrevista, reunião etc.).',
          },
          {
            q: 'Como separar quem falou na transcrição?',
            a: 'Ative "Identificar quem falou" antes de processar: a transcrição sai separada por falante (Falante A, B...). Quando a própria conversa prova quem é quem (a pessoa se apresenta, ou é chamada pelo nome e responde em seguida), o ANA troca o rótulo pelo nome; sem essa prova, não adivinha. Na aba Transcrição, em "Quem falou", você vê o trecho que prova cada nome, pode procurar de novo e dar ou corrigir nomes à mão.',
          },
        ],
      },
      {
        id: 'organize',
        title: 'Organizar: pastas, prioridade, tarefas e agenda',
        items: [
          {
            q: 'Como funcionam as pastas?',
            a: 'Toque no ícone de pasta no topo da tela inicial para criar e gerenciar até 10 pastas coloridas. Dentro de uma nota, use "Adicionar a uma pasta". Na tela inicial, filtre pelas pastas logo abaixo da busca.',
          },
          {
            q: 'Como defino a prioridade de uma nota?',
            a: 'Dentro da nota, no menu "…", escolha Alta, Média ou Baixa. A bandeirinha colorida aparece no card e dentro da nota, e dá para ordenar a tela inicial por prioridade.',
          },
          {
            q: 'Onde ficam minhas tarefas?',
            a: 'Em "Tarefas" ficam os itens de ação das reuniões e as tarefas que você cria. Dá para concluir, editar, excluir, marcar a urgência (alta, normal ou baixa) e filtrar. O que você muda num item de reunião vale também na nota de origem.',
          },
          {
            q: 'Como uso a Agenda?',
            a: 'Conecte o Google Calendar em "Agenda" (o ANA só lê seus eventos, não altera nada). Os compromissos aparecem por dia, um mês por vez, com as setas para trocar de mês. Em cada evento há "Gravar reunião" e, quando existe, "Entrar na chamada".',
          },
        ],
      },
      {
        id: 'share',
        title: 'Compartilhar, amigos e avisos',
        items: [
          {
            q: 'Como compartilho uma nota?',
            a: 'Dentro da nota, toque em "Compartilhar": WhatsApp, e-mail, PDF, Word, copiar ou baixar. Você também pode enviar uma cópia para um colega cadastrado no ANA; ele recebe a transcrição e o resumo, sem o áudio, e a cópia é dele.',
          },
          {
            q: 'Onde vejo as notas que recebi?',
            a: 'Em "Compartilhados comigo" (menu lateral ou Configurações). As notas recebidas também aparecem na sua lista e geram um aviso no sininho.',
          },
          {
            q: 'Para que servem os Amigos?',
            a: 'Adicione colegas que usam o ANA para enviar cópias de notas, trocar recados rápidos e "cutucar". As mensagens são apagadas automaticamente depois de 7 dias.',
          },
          {
            q: 'O que é o sininho da tela inicial?',
            a: 'Reúne o que pede sua atenção: avisos da equipe, notas recebidas, pedidos de amizade, mensagens e respostas do suporte. A bolinha mostra quantos faltam ler. Toque no aviso para ir direto ao lugar, ou no ✓ para marcar como lido.',
          },
        ],
      },
      {
        id: 'data',
        title: 'Conta, dados e privacidade',
        items: [
          {
            q: 'Por quanto tempo o áudio fica guardado?',
            a: 'Por padrão o áudio é excluído automaticamente em 3 dias. A transcrição e o resumo continuam na sua conta. Em Configurações → Período de auto-delete você escolhe 3, 7 ou 14 dias, e em cada nota pode ligar "Manter áudio para sempre".',
          },
          {
            q: 'Excluí uma nota sem querer. E agora?',
            a: 'Notas excluídas vão para a Lixeira (Configurações → Lixeira) e podem ser restauradas por 7 dias. Depois disso são apagadas definitivamente.',
          },
          {
            q: 'Como baixo todos os meus dados?',
            a: 'Em Configurações → Exportar meus dados. O ANA baixa um arquivo de texto com todas as suas notas: título, data, resumo, itens de ação e transcrição.',
          },
          {
            q: 'Como excluo minha conta?',
            a: 'Em Configurações → Excluir minha conta. É preciso digitar EXCLUIR para confirmar. Suas notas e áudios são apagados e isso não pode ser desfeito.',
          },
        ],
      },
      {
        id: 'windows',
        title: 'App para Windows',
        items: [
          {
            q: 'Como instalo o app para Windows?',
            a: 'Em Configurações → Baixar aplicativo Windows. Abra o arquivo baixado: a instalação é automática e não pede senha de administrador.',
          },
          {
            q: 'Como atualizo o app?',
            a: 'O app baixa as atualizações sozinho. Quando aparecer "Reiniciar e atualizar", toque no botão: o app fecha, uma janela mostra o andamento e ele abre de novo já atualizado. Se preferir, ele atualiza na próxima vez que você fechar.',
          },
        ],
      },
    ],
  },
  en: {
    title: 'Help center',
    intro: 'Quick answers on how to use ANA by Tailor.',
    search: 'Search help (e.g. folder, audio, Windows)',
    noResults: 'Nothing found',
    noResultsSub: 'Try another word or ask ANA directly.',
    stillTitle: "Didn't find what you were looking for?",
    stillSub: 'ANA answers right away. If something is broken, open a ticket: the reply arrives in the bell.',
    askAna: 'Ask ANA',
    support: 'Contact support',
    categories: [
      {
        id: 'record',
        title: 'Recording and creating notes',
        items: [
          {
            q: 'How do I create a note?',
            a: 'Tap the microphone in the center of the bottom bar (on a computer, "New Recording" in the side menu) and choose: record, upload audio, upload video, PDF/file/text or web link. The transcript, summary and action items are generated automatically.',
          },
          {
            q: 'How do I record a meeting on my computer?',
            a: 'In the ANA app for Windows, recording captures the computer sound (Teams, Zoom, Meet, WhatsApp) and your microphone, even with headphones. Ctrl+Shift+G starts recording right away. In the browser (Chrome or Edge), pick the meeting tab and keep "Also share tab audio" checked.',
          },
          {
            q: 'Can I import a PDF, DOCX or a link?',
            a: 'Yes. Under "PDF, file or text", the text of PDFs and DOCX files is extracted when you process it. Under "Web link", the AI opens the page, takes the main content and summarizes it.',
          },
          {
            q: 'Are title, topic and context required?',
            a: 'No, all are optional. Topic and context only help the AI analyze in the right format (interview, meeting, etc.).',
          },
          {
            q: 'How do I separate speakers in the transcript?',
            a: 'Turn on "Identify who spoke" before processing: the transcript comes out split by speaker (Speaker A, B...). When the conversation itself proves who is who (someone introduces themselves, or is called by name and replies right after), ANA replaces the label with the name; without that proof, it does not guess. In the Transcript tab, under "Who spoke", you can see the excerpt behind each name, search again, and add or fix names by hand.',
          },
        ],
      },
      {
        id: 'organize',
        title: 'Organizing: folders, priority, tasks and agenda',
        items: [
          {
            q: 'How do folders work?',
            a: 'Tap the folder icon at the top of the home screen to create and manage up to 10 colored folders. Inside a note, use "Add to a folder". On the home screen, filter by folder right below the search.',
          },
          {
            q: 'How do I set a note priority?',
            a: 'Inside the note, in the "…" menu, choose High, Medium or Low. The colored flag shows on the card and inside the note, and you can sort the home screen by priority.',
          },
          {
            q: 'Where are my tasks?',
            a: '"Tasks" holds the action items from your meetings and the tasks you create. You can complete, edit, delete, set urgency (high, normal or low) and filter. Changes to a meeting item also apply to its source note.',
          },
          {
            q: 'How do I use the Agenda?',
            a: 'Connect Google Calendar under "Agenda" (ANA only reads your events and never changes them). Events are grouped by day, one month at a time, with arrows to switch months. Each event has "Record meeting" and, when available, "Join call".',
          },
        ],
      },
      {
        id: 'share',
        title: 'Sharing, friends and notices',
        items: [
          {
            q: 'How do I share a note?',
            a: 'Inside the note, tap "Share": WhatsApp, email, PDF, Word, copy or download. You can also send a copy to a colleague registered in ANA; they get the transcript and summary, without the audio, and the copy is theirs.',
          },
          {
            q: 'Where are the notes I received?',
            a: 'In "Shared with me" (side menu or Settings). Received notes also show up in your list and create a notice in the bell.',
          },
          {
            q: 'What are Friends for?',
            a: 'Add colleagues who use ANA to send them note copies, swap quick messages and "poke" them. Messages are deleted automatically after 7 days.',
          },
          {
            q: 'What is the bell on the home screen?',
            a: 'It gathers what needs your attention: team notices, received notes, friend requests, messages and support replies. The badge shows how many are unread. Tap a notice to go straight there, or ✓ to mark it as read.',
          },
        ],
      },
      {
        id: 'data',
        title: 'Account, data and privacy',
        items: [
          {
            q: 'How long is the audio kept?',
            a: 'By default the audio is deleted automatically after 3 days. The transcript and summary stay in your account. In Settings → Auto-delete period you can choose 3, 7 or 14 days, and turn on "Keep audio forever" per note.',
          },
          {
            q: 'I deleted a note by mistake. What now?',
            a: 'Deleted notes go to the Trash (Settings → Trash) and can be restored for 7 days. After that they are permanently deleted.',
          },
          {
            q: 'How do I download all my data?',
            a: 'Settings → Export my data. ANA downloads a text file with all your notes: title, date, summary, action items and transcript.',
          },
          {
            q: 'How do I delete my account?',
            a: 'Settings → Delete my account. Type EXCLUIR to confirm. Your notes and audio are deleted and this cannot be undone.',
          },
        ],
      },
      {
        id: 'windows',
        title: 'Windows app',
        items: [
          {
            q: 'How do I install the Windows app?',
            a: 'Settings → Download Windows app. Open the downloaded file: installation is automatic and does not ask for an administrator password.',
          },
          {
            q: 'How do I update the app?',
            a: 'The app downloads updates on its own. When "Restart & update" shows up, tap it: the app closes, a window shows the progress and it opens again already updated. Otherwise it updates the next time you close it.',
          },
        ],
      },
    ],
  },
  es: {
    title: 'Centro de ayuda',
    intro: 'Respuestas rápidas sobre cómo usar ANA by Tailor.',
    search: 'Buscar en la ayuda (ej.: carpeta, audio, Windows)',
    noResults: 'No se encontró nada',
    noResultsSub: 'Prueba otra palabra o pregúntale directamente a ANA.',
    stillTitle: '¿No encontraste lo que buscabas?',
    stillSub: 'ANA responde al instante. Si algo falla, abre un ticket: la respuesta llega a la campanita.',
    askAna: 'Preguntar a ANA',
    support: 'Hablar con soporte',
    categories: [
      {
        id: 'record',
        title: 'Grabar y crear notas',
        items: [
          {
            q: '¿Cómo creo una nota?',
            a: 'Toca el micrófono en el centro de la barra inferior (en el ordenador, "Grabación inteligente" en el menú lateral) y elige: grabar, subir audio, subir video, PDF/archivo/texto o enlace web. La transcripción, el resumen y los ítems de acción se generan automáticamente.',
          },
          {
            q: '¿Cómo grabo una reunión en el ordenador?',
            a: 'En la app ANA para Windows, la grabación capta el sonido del ordenador (Teams, Zoom, Meet, WhatsApp) y tu micrófono, incluso con auriculares. Ctrl+Shift+G empieza a grabar al instante. En el navegador (Chrome o Edge), elige la pestaña de la reunión y deja marcado "Compartir también el audio de la pestaña".',
          },
          {
            q: '¿Puedo importar PDF, DOCX o un enlace?',
            a: 'Sí. En "PDF, archivo o texto", el texto de PDF y DOCX se extrae al procesar. En "Enlace web", la IA abre la página, toma el contenido principal y lo resume.',
          },
          {
            q: '¿Título, tema y contexto son obligatorios?',
            a: 'No, todos son opcionales. El tema y el contexto solo ayudan a la IA a analizar en el formato correcto (entrevista, reunión, etc.).',
          },
          {
            q: '¿Cómo separo quién habló en la transcripción?',
            a: 'Activa "Identificar quién habló" antes de procesar: la transcripción sale separada por hablante (Hablante A, B...). Cuando la propia conversación prueba quién es quién (alguien se presenta, o lo llaman por su nombre y responde enseguida), ANA cambia la etiqueta por el nombre; sin esa prueba, no adivina. En la pestaña Transcripción, en "Quién habló", ves el fragmento que prueba cada nombre, puedes buscar de nuevo y poner o corregir nombres a mano.',
          },
        ],
      },
      {
        id: 'organize',
        title: 'Organizar: carpetas, prioridad, tareas y agenda',
        items: [
          {
            q: '¿Cómo funcionan las carpetas?',
            a: 'Toca el icono de carpeta arriba en la pantalla de inicio para crear y administrar hasta 10 carpetas de colores. Dentro de una nota, usa "Añadir a una carpeta". En el inicio, filtra por carpeta justo debajo de la búsqueda.',
          },
          {
            q: '¿Cómo defino la prioridad de una nota?',
            a: 'Dentro de la nota, en el menú "…", elige Alta, Media o Baja. La banderita de color aparece en la tarjeta y dentro de la nota, y puedes ordenar el inicio por prioridad.',
          },
          {
            q: '¿Dónde están mis tareas?',
            a: 'En "Tareas" están los ítems de acción de tus reuniones y las tareas que creas. Puedes completarlas, editarlas, eliminarlas, marcar la urgencia (alta, normal o baja) y filtrar. Los cambios en un ítem de reunión también valen en la nota de origen.',
          },
          {
            q: '¿Cómo uso la Agenda?',
            a: 'Conecta Google Calendar en "Agenda" (ANA solo lee tus eventos, no cambia nada). Los eventos aparecen por día, un mes a la vez, con flechas para cambiar de mes. Cada evento tiene "Grabar reunión" y, cuando existe, "Entrar a la llamada".',
          },
        ],
      },
      {
        id: 'share',
        title: 'Compartir, amigos y avisos',
        items: [
          {
            q: '¿Cómo comparto una nota?',
            a: 'Dentro de la nota, toca "Compartir": WhatsApp, correo, PDF, Word, copiar o descargar. También puedes enviar una copia a un colega registrado en ANA; recibe la transcripción y el resumen, sin el audio, y la copia es suya.',
          },
          {
            q: '¿Dónde veo las notas que recibí?',
            a: 'En "Compartidos conmigo" (menú lateral o Ajustes). Las notas recibidas también aparecen en tu lista y generan un aviso en la campanita.',
          },
          {
            q: '¿Para qué sirven los Amigos?',
            a: 'Agrega colegas que usan ANA para enviarles copias de notas, intercambiar recados rápidos y darles un "toque". Los mensajes se borran automáticamente después de 7 días.',
          },
          {
            q: '¿Qué es la campanita del inicio?',
            a: 'Reúne lo que necesita tu atención: avisos del equipo, notas recibidas, solicitudes de amistad, mensajes y respuestas del soporte. El número muestra cuántos faltan por leer. Toca un aviso para ir directo, o ✓ para marcarlo como leído.',
          },
        ],
      },
      {
        id: 'data',
        title: 'Cuenta, datos y privacidad',
        items: [
          {
            q: '¿Cuánto tiempo se guarda el audio?',
            a: 'Por defecto el audio se elimina automáticamente a los 3 días. La transcripción y el resumen siguen en tu cuenta. En Ajustes → Período de auto-eliminación eliges 3, 7 o 14 días, y en cada nota puedes activar "Mantener audio para siempre".',
          },
          {
            q: 'Borré una nota por error. ¿Y ahora?',
            a: 'Las notas eliminadas van a la Papelera (Ajustes → Papelera) y se pueden restaurar durante 7 días. Después se borran definitivamente.',
          },
          {
            q: '¿Cómo descargo todos mis datos?',
            a: 'Ajustes → Exportar mis datos. ANA descarga un archivo de texto con todas tus notas: título, fecha, resumen, ítems de acción y transcripción.',
          },
          {
            q: '¿Cómo elimino mi cuenta?',
            a: 'Ajustes → Eliminar mi cuenta. Escribe EXCLUIR para confirmar. Tus notas y audios se borran y no se puede deshacer.',
          },
        ],
      },
      {
        id: 'windows',
        title: 'App para Windows',
        items: [
          {
            q: '¿Cómo instalo la app para Windows?',
            a: 'Ajustes → Descargar aplicación Windows. Abre el archivo descargado: la instalación es automática y no pide contraseña de administrador.',
          },
          {
            q: '¿Cómo actualizo la app?',
            a: 'La app descarga las actualizaciones sola. Cuando aparezca "Reiniciar y actualizar", tócalo: la app se cierra, una ventana muestra el progreso y se abre de nuevo ya actualizada. Si no, se actualiza la próxima vez que la cierres.',
          },
        ],
      },
    ],
  },
}

/** Sem acento e minusculo: "audio" acha "áudio". */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function Help() {
  const { lang } = useI18n()
  const navigate = useNavigate()
  const faq = FAQ[lang] ?? FAQ.pt
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [anaOpen, setAnaOpen] = useState(false)

  const results = useMemo(() => {
    const q = norm(query.trim())
    if (!q) return faq.categories
    const terms = q.split(/\s+/)
    return faq.categories
      .map((c) => ({
        ...c,
        items: c.items.filter((it) => {
          const hay = norm(`${it.q} ${it.a} ${c.title}`)
          return terms.every((term) => hay.includes(term))
        }),
      }))
      .filter((c) => c.items.length > 0)
  }, [faq, query])

  const searching = query.trim() !== ''

  return (
    <div className="px-5 safe-top pb-16 max-w-3xl mx-auto">
      <header className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate('/config')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold">{faq.title}</h1>
          <p className="text-sm text-content-muted">{faq.intro}</p>
        </div>
      </header>

      <div className="relative mb-4">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" />
        <input
          className="input pl-11"
          placeholder={faq.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          enterKeyHint="search"
        />
      </div>

      {!searching && (
        <nav className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1" aria-label={faq.title}>
          {faq.categories.map((c) => (
            <a
              key={c.id}
              href={`#ajuda-${c.id}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(`ajuda-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-surface-border bg-surface-elevated px-3 py-1.5 text-sm text-content-secondary hover:text-content-primary"
            >
              <span className="text-accent">{ICONS[c.id]}</span>
              {c.title.split(':')[0]}
            </a>
          ))}
        </nav>
      )}

      {results.length === 0 ? (
        <div className="card p-8 text-center">
          <SearchX size={32} className="mx-auto text-content-muted mb-3" />
          <p className="font-medium">{faq.noResults}</p>
          <p className="text-sm text-content-muted mt-1">{faq.noResultsSub}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {results.map((c) => (
            <section key={c.id} id={`ajuda-${c.id}`} className="scroll-mt-6">
              <h2 className="flex items-center gap-2 font-display font-semibold mb-2 px-1">
                <span className="text-accent">{ICONS[c.id]}</span>
                {c.title}
              </h2>
              <ul className="card divide-y divide-surface-border overflow-hidden">
                {c.items.map((it) => {
                  const key = `${c.id}:${it.q}`
                  const isOpen = searching || open === key
                  return (
                    <li key={key}>
                      <button
                        onClick={() => setOpen(isOpen && !searching ? null : key)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-elevated/60"
                      >
                        <span className="flex-1 font-medium text-sm">{it.q}</span>
                        <ChevronDown
                          size={18}
                          className={`text-content-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {isOpen && (
                        <p className="px-4 pb-4 -mt-1 text-sm leading-relaxed text-content-secondary">{it.a}</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="card p-5 mt-8 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold">{faq.stillTitle}</p>
          <p className="text-sm text-content-muted mt-0.5">{faq.stillSub}</p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button onClick={() => setAnaOpen(true)} className="btn-outline h-10 px-3 text-sm">
            <AnaIcon size={16} /> {faq.askAna}
          </button>
          <button onClick={() => navigate('/suporte')} className="btn-primary h-10 px-3 text-sm">
            <LifeBuoy size={16} /> {faq.support}
          </button>
        </div>
      </div>

      {anaOpen && <HelpAssistant open={anaOpen} onClose={() => setAnaOpen(false)} />}
    </div>
  )
}
