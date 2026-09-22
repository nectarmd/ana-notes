import { ScrollText } from 'lucide-react'
import { DocList, DocPage, type DocSectionData } from './DocPage'

const SECTIONS: DocSectionData[] = [
  {
    id: 'aceitacao',
    title: 'Aceitação',
    body: (
      <p>
        Ao usar o ANA (“aplicativo”), fornecido pela Nectar MD Consulting, você concorda com estes Termos. O acesso é restrito a colaboradores
        com e-mail @tailorexec.com.br.
      </p>
    ),
  },
  {
    id: 'uso',
    title: 'O que o aplicativo faz',
    body: (
      <>
        <p>O aplicativo grava, transcreve, resume e organiza reuniões, áudios, vídeos, documentos e links. Ele também permite:</p>
        <DocList
          items={[
            'gerar resumos, itens de ação, análises e mapas mentais com inteligência artificial;',
            'organizar notas em pastas, com prioridade e tarefas;',
            'ver a agenda do Google Calendar, se você conectar;',
            'enviar cópias de notas e recados curtos a colegas cadastrados.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'gravacao',
    title: 'Gravação e consentimento',
    body: (
      <p>
        Você é responsável pelo que grava. Antes de gravar uma reunião ou ligação, informe as demais pessoas e obtenha
        o consentimento delas quando a lei exigir, conforme a LGPD e as normas internas da Tailor.
      </p>
    ),
  },
  {
    id: 'conta',
    title: 'Conta e segurança',
    body: (
      <p>
        Mantenha sua senha em sigilo e não compartilhe sua conta. Se suspeitar de uso indevido, troque a senha e avise
        o administrador pelo suporte.
      </p>
    ),
  },
  {
    id: 'conteudo',
    title: 'Conteúdo e propriedade',
    body: (
      <p>
        O conteúdo das suas notas pertence a você e à Tailor. O aplicativo processa esse conteúdo (transcrição,
        resumo, análise) apenas para prestar o serviço. Quando você envia uma cópia de nota a um colega, a cópia passa
        a ser dele, que pode editá-la ou excluí-la; a sua nota continua intacta.
      </p>
    ),
  },
  {
    id: 'ia',
    title: 'Inteligência artificial',
    body: (
      <p>
        Transcrições, resumos, análises e sugestões são gerados por IA e podem conter erros, omissões ou nomes trocados.
        Revise as informações importantes antes de tomar decisões ou repassá-las.
      </p>
    ),
  },
  {
    id: 'uso-aceitavel',
    title: 'Uso aceitável',
    body: (
      <>
        <p>Não é permitido usar o aplicativo para:</p>
        <DocList
          items={[
            'fins ilegais ou contrários às políticas da Tailor;',
            'gravar pessoas sem consentimento quando ele for exigido;',
            'tentar acessar dados de outras pessoas ou comprometer a segurança do sistema;',
            'enviar mensagens ofensivas ou abusivas a colegas.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'retencao',
    title: 'Prazos de guarda e exclusão',
    body: (
      <DocList
        items={[
          <>
            <strong className="text-content-primary">Áudio:</strong> excluído automaticamente depois do prazo escolhido
            em Configurações (3, 7 ou 14 dias; 3 por padrão), exceto nas notas marcadas para manter o áudio.
          </>,
          <>
            <strong className="text-content-primary">Transcrições, resumos e notas:</strong> ficam na sua conta até você
            excluir.
          </>,
          <>
            <strong className="text-content-primary">Lixeira:</strong> notas excluídas podem ser restauradas por 7 dias;
            depois são apagadas definitivamente.
          </>,
          <>
            <strong className="text-content-primary">Mensagens entre amigos:</strong> apagadas automaticamente depois de
            7 dias.
          </>,
        ]}
      />
    ),
  },
  {
    id: 'disponibilidade',
    title: 'Disponibilidade e mudanças',
    body: (
      <p>
        O aplicativo pode ficar indisponível para manutenção, com aviso no próprio app sempre que possível. Estes Termos
        podem ser atualizados; a data da última atualização aparece no topo desta página.
      </p>
    ),
  },
  {
    id: 'responsabilidade',
    title: 'Limitação de responsabilidade',
    body: (
      <p>
        O aplicativo é fornecido “como está”. Na máxima extensão permitida por lei, não nos responsabilizamos por perdas
        decorrentes do uso, inclusive de conteúdo gerado por IA.
      </p>
    ),
  },
  {
    id: 'contato',
    title: 'Contato',
    body: <p>Dúvidas sobre estes Termos: abra um chamado em Configurações → Falar com o suporte.</p>,
  },
]

export function Terms() {
  return (
    <DocPage
      title="Termos de serviço"
      subtitle="As regras de uso do ANA, em linguagem direta."
      icon={<ScrollText size={22} />}
      updated="Última atualização: 22 de setembro de 2026"
      sections={SECTIONS}
    />
  )
}
