import { DocPage, DocSection } from './DocPage'
import { useI18n } from '../lib/i18n'

type Faq = { title: string; intro: string; items: { q: string; a: string }[] }

const FAQ: Record<'pt' | 'en' | 'es', Faq> = {
  pt: {
    title: 'Central de ajuda',
    intro: 'Perguntas frequentes sobre como usar a ANA by Tailor.',
    items: [
      {
        q: 'Como crio uma nota?',
        a: 'Toque no microfone no centro da barra inferior para gravar, ou em "Funções/Nova nota" para escolher: Gravar reunião, Enviar áudio, Enviar vídeo, PDF/arquivo/texto ou Link da web. A transcrição e o resumo são gerados automaticamente.',
      },
      {
        q: "O que é 'Gravar reunião'?",
        a: 'No app ANA para Windows, capta o som do computador (Teams, Zoom, Meet, WhatsApp) + o seu microfone — funciona até de fone; o atalho Ctrl+Shift+G já começa a gravar. No navegador (Chrome/Edge), escolha a aba da reunião e deixe marcado "Compartilhar também o áudio da guia".',
      },
      {
        q: 'Importar PDF, DOCX ou link',
        a: 'Em "PDF, arquivo ou texto", o texto de PDFs e DOCX é extraído automaticamente ao processar. Em "Link da web", a IA abre a página, extrai o conteúdo principal e gera o resumo.',
      },
      {
        q: 'Os campos (título, tema, contexto) são obrigatórios?',
        a: 'Não. Todos são opcionais. O tema e o contexto apenas ajudam a IA a analisar no formato certo (entrevista, reunião, etc.).',
      },
      {
        q: 'Identificar quem falou (diarização)',
        a: 'Ative a chave "Identificar quem falou" antes de processar para separar os falantes na transcrição. Tem um custo um pouco maior.',
      },
      {
        q: 'Prioridade das notas',
        a: 'Dentro da nota, no menu "…", defina a prioridade (Alta, Média ou Baixa). Ela aparece como uma bandeirinha colorida no card da nota e dentro dela.',
      },
      {
        q: 'Minhas tarefas',
        a: 'Os itens de ação das suas reuniões e as tarefas que você cria ficam em "Tarefas". Dá para concluir, editar, excluir e marcar a urgência (alta, normal ou baixa) com a bandeirinha, e filtrar por situação e por urgência. O que você muda num item de reunião vale também na nota de origem.',
      },
      {
        q: 'Como compartilho uma nota?',
        a: 'Dentro da nota, toque em "Compartilhar": WhatsApp, e-mail, PDF, Word, copiar, baixar áudio/transcrição — e também enviar uma cópia para um colega cadastrado no ANA (sem o áudio).',
      },
      {
        q: 'Por quanto tempo o áudio fica guardado?',
        a: 'Por padrão o áudio é excluído automaticamente em 3 dias; a transcrição e o resumo ficam guardados para sempre. Em Configurações → Exclusão automática do áudio você escolhe 3, 7 ou 14 dias, e em cada nota pode ligar "Manter áudio para sempre".',
      },
      {
        q: 'Precisa de suporte?',
        a: 'Abra um chamado em Configurações → Falar com o suporte, escolhendo o tema (Financeiro, Técnico, Feedback ou Outros).',
      },
    ],
  },
  en: {
    title: 'Help center',
    intro: 'Frequently asked questions about using ANA by Tailor.',
    items: [
      {
        q: 'How do I create a note?',
        a: 'Tap the microphone in the center of the bottom bar to record, or "More/New note" to choose: Record meeting, Upload audio, Upload video, PDF/file/text or Web link. The transcript and summary are generated automatically.',
      },
      {
        q: "What is 'Record meeting'?",
        a: 'In the ANA app for Windows it captures the computer sound (Teams, Zoom, Meet, WhatsApp) + your microphone — even with headphones; Ctrl+Shift+G starts recording right away. In the browser (Chrome/Edge), pick the meeting tab and keep "Also share tab audio" checked.',
      },
      {
        q: 'Import PDF, DOCX or a link',
        a: 'Under "PDF, file or text", the text of PDFs and DOCX is extracted automatically when you process it. Under "Web link", the AI opens the page, extracts the main content and summarizes it.',
      },
      {
        q: 'Are the fields (title, topic, context) required?',
        a: 'No. All are optional. Topic and context only help the AI analyze in the right format (interview, meeting, etc.).',
      },
      {
        q: 'Identify who spoke (diarization)',
        a: 'Turn on "Identify who spoke" before processing to separate speakers in the transcript. It costs a bit more.',
      },
      {
        q: 'Note priority',
        a: 'Inside a note, in the "…" menu, set the priority (High, Medium or Low). It shows as a colored flag on the note card and inside it.',
      },
      {
        q: 'My tasks',
        a: 'Action items from your meetings and the tasks you create live in "Tasks". You can complete, edit, delete and set the urgency (high, normal or low) with the flag, and filter by status and urgency. Changes to a meeting item also apply to its source note.',
      },
      {
        q: 'How do I share a note?',
        a: 'Inside a note, tap "Share": WhatsApp, email, PDF, Word, copy, download audio/transcript — or send a copy to a colleague registered in ANA (without the audio).',
      },
      {
        q: 'How long is the audio kept?',
        a: 'By default the audio is deleted automatically after 3 days; the transcript and summary are kept forever. In Settings you can choose 3, 7 or 14 days, and turn on "Keep audio forever" per note.',
      },
      {
        q: 'Need support?',
        a: 'Open a ticket in Settings → Support, choosing the topic (Billing, Technical, Feedback or Other).',
      },
    ],
  },
  es: {
    title: 'Centro de ayuda',
    intro: 'Preguntas frecuentes sobre el uso de ANA by Tailor.',
    items: [
      {
        q: '¿Cómo creo una nota?',
        a: 'Toca el micrófono en el centro de la barra inferior para grabar, o "Funciones/Nueva nota" para elegir: Grabar reunión, Subir audio, Subir video, PDF/archivo/texto o Enlace web. La transcripción y el resumen se generan automáticamente.',
      },
      {
        q: '¿Qué es "Grabar reunión"?',
        a: 'En la app ANA para Windows capta el sonido del ordenador (Teams, Zoom, Meet, WhatsApp) + tu micrófono — incluso con auriculares; Ctrl+Shift+G empieza a grabar al instante. En el navegador (Chrome/Edge), elige la pestaña de la reunión y deja marcado "Compartir también el audio de la pestaña".',
      },
      {
        q: 'Importar PDF, DOCX o un enlace',
        a: 'En "PDF, archivo o texto", el texto de PDF y DOCX se extrae automáticamente al procesar. En "Enlace web", la IA abre la página, extrae el contenido principal y lo resume.',
      },
      {
        q: '¿Los campos (título, tema, contexto) son obligatorios?',
        a: 'No. Todos son opcionales. El tema y el contexto solo ayudan a la IA a analizar en el formato correcto (entrevista, reunión, etc.).',
      },
      {
        q: 'Identificar quién habló (diarización)',
        a: 'Activa "Identificar quién habló" antes de procesar para separar los hablantes en la transcripción. Tiene un coste un poco mayor.',
      },
      {
        q: 'Prioridad de las notas',
        a: 'Dentro de la nota, en el menú "…", define la prioridad (Alta, Media o Baja). Aparece como una banderita de color en la tarjeta de la nota y dentro de ella.',
      },
      {
        q: 'Mis tareas',
        a: 'Los ítems de acción de tus reuniones y las tareas que creas están en "Tareas". Puedes completarlas, editarlas, eliminarlas y marcar la urgencia (alta, normal o baja) con la banderita, y filtrar por estado y urgencia. Los cambios en un ítem de reunión también valen en la nota de origen.',
      },
      {
        q: '¿Cómo comparto una nota?',
        a: 'Dentro de la nota, toca "Compartir": WhatsApp, correo, PDF, Word, copiar, descargar audio/transcripción — o enviar una copia a un colega registrado en ANA (sin el audio).',
      },
      {
        q: '¿Cuánto tiempo se guarda el audio?',
        a: 'Por defecto el audio se elimina automáticamente a los 3 días; la transcripción y el resumen se conservan para siempre. En Ajustes puedes elegir 3, 7 o 14 días, y activar "Mantener audio para siempre" en cada nota.',
      },
      {
        q: '¿Necesitas soporte?',
        a: 'Abre un ticket en Ajustes → Soporte, eligiendo el tema (Facturación, Técnico, Feedback u Otros).',
      },
    ],
  },
}

export function Help() {
  const { lang } = useI18n()
  const faq = FAQ[lang] ?? FAQ.pt
  return (
    <DocPage title={faq.title}>
      <p>{faq.intro}</p>
      {faq.items.map((it) => (
        <DocSection key={it.q} title={it.q}>
          <p>{it.a}</p>
        </DocSection>
      ))}
    </DocPage>
  )
}
