import { FileLock2 } from 'lucide-react'
import { DocList, DocPage, type DocSectionData } from './DocPage'

/**
 * Revisada em 17/09/2026 contra o codigo: prazos iguais aos da limpeza automatica
 * (retention-cleanup e cron das migrations 0041/0042), provedores iguais aos das edge functions.
 */
const SECTIONS: DocSectionData[] = [
  {
    id: 'dados',
    title: 'Dados que coletamos',
    body: (
      <DocList
        items={[
          <>
            <strong className="text-content-primary">Cadastro:</strong> nome, sobrenome, e-mail corporativo, telefone e,
            se você quiser, foto.
          </>,
          <>
            <strong className="text-content-primary">Conteúdo que você cria:</strong> áudios, vídeos, documentos, links,
            transcrições, resumos, notas, tarefas, pastas e recados a amigos.
          </>,
          <>
            <strong className="text-content-primary">Dados técnicos:</strong> registros de erro (com navegador e sistema
            usados) e registros de uso da IA (quantidade e custo das chamadas), para manter o app funcionando e controlar
            custos.
          </>,
          <>
            <strong className="text-content-primary">Google Calendar (opcional):</strong> se você conectar, lemos seus
            eventos, sem permissão para alterá-los.
          </>,
        ]}
      />
    ),
  },
  {
    id: 'uso',
    title: 'Como usamos',
    body: (
      <p>
        Para autenticar você, gerar transcrições, resumos e análises, organizar suas notas, mostrar sua agenda, permitir
        o envio de cópias a colegas e responder chamados de suporte. Não usamos seus dados para publicidade e não
        vendemos dados.
      </p>
    ),
  },
  {
    id: 'armazenamento',
    title: 'Onde ficam armazenados',
    body: (
      <p>
        No Supabase (banco de dados Postgres e armazenamento privado de arquivos). Os áudios ficam em armazenamento
        privado, acessível só pela sua conta. No app para Windows, uma cópia de segurança de cada gravação é salva no
        próprio computador antes de transcrever (a pasta aparece em Configurações → App do Windows).
      </p>
    ),
  },
  {
    id: 'ia',
    title: 'Provedores de inteligência artificial',
    body: (
      <>
        <p>Para gerar os resultados, o conteúdo é enviado a:</p>
        <DocList
          items={[
            <>
              <strong className="text-content-primary">Groq e AssemblyAI:</strong> transcrição do áudio.
            </>,
            <>
              <strong className="text-content-primary">Anthropic (Claude):</strong> resumos, itens de ação, análises,
              mapas mentais e respostas da ANA.
            </>,
          ]}
        />
        <p>
          O envio é feito pelo nosso servidor; as chaves desses serviços nunca ficam no aplicativo. Para não processar o
          mesmo arquivo duas vezes, guardamos por até 7 dias uma cópia da transcrição associada ao arquivo enviado, e por
          até 2 dias o resultado da IA para o mesmo texto.
        </p>
      </>
    ),
  },
  {
    id: 'compartilhamento',
    title: 'Compartilhamento',
    body: (
      <p>
        Suas notas só saem da sua conta quando você decide: exportando (WhatsApp, e-mail, PDF, Word) ou enviando uma
        cópia a um colega cadastrado. A cópia leva transcrição e resumos, mas não leva o áudio nem as conversas com a
        ANA.
      </p>
    ),
  },
  {
    id: 'prazos',
    title: 'Por quanto tempo guardamos',
    body: (
      <DocList
        items={[
          'Áudio: 3, 7 ou 14 dias, conforme sua escolha em Configurações (3 por padrão), exceto nas notas marcadas para manter o áudio.',
          'Transcrições, resumos e notas: até você excluir.',
          'Lixeira: 7 dias; depois a nota é apagada definitivamente.',
          'Mensagens entre amigos: 7 dias.',
          'Registros de erro: 30 dias (avisos) ou 90 dias (erros graves).',
          'Conta excluída: notas, áudios e foto são apagados.',
        ]}
      />
    ),
  },
  {
    id: 'seguranca',
    title: 'Segurança e acesso',
    body: (
      <p>
        O acesso exige login, e regras no banco de dados garantem que cada pessoa veja só os próprios dados. O
        administrador vê números de uso por pessoa, os chamados de suporte e o registro técnico de erros, para dar
        suporte e manter o serviço.
      </p>
    ),
  },
  {
    id: 'direitos',
    title: 'Seus direitos (LGPD)',
    body: (
      <>
        <p>Você pode, a qualquer momento:</p>
        <DocList
          items={[
            'acessar e baixar seus dados em Configurações → Exportar meus dados;',
            'corrigir seu cadastro em Editar perfil;',
            'desconectar o Google Calendar na Agenda;',
            'excluir qualquer nota, ou a conta inteira em Configurações → Excluir minha conta.',
          ]}
        />
        <p>Outras solicitações: abra um chamado em Configurações → Falar com o suporte.</p>
      </>
    ),
  },
  {
    id: 'consentimento',
    title: 'Consentimento de gravação',
    body: (
      <p>
        Ao gravar reuniões e ligações, informe as demais pessoas e obtenha o consentimento delas quando a lei exigir.
      </p>
    ),
  },
]

export function Privacy() {
  return (
    <DocPage
      title="Política de privacidade"
      subtitle="Quais dados o ANA usa, para quê, onde ficam e por quanto tempo."
      icon={<FileLock2 size={22} />}
      updated="Última atualização: 17 de setembro de 2026 · uso interno Tailor"
      sections={SECTIONS}
    />
  )
}
