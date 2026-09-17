import { DocPage, DocSection } from './DocPage'

export function Privacy() {
  return (
    <DocPage title="Política de privacidade">
      <p className="text-sm text-content-muted">Última atualização: setembro de 2026 · uso interno Tailor.</p>

      <DocSection title="Dados que coletamos">
        <p>Nome, sobrenome, e-mail corporativo e telefone (no cadastro). Conteúdo que você cria: áudios, transcrições, resumos, notas, tarefas e dados técnicos de uso.</p>
      </DocSection>
      <DocSection title="Como usamos">
        <p>Para autenticar, gerar transcrições, resumos e análises com IA, organizar suas notas e permitir o compartilhamento com as pessoas que você escolher.</p>
      </DocSection>
      <DocSection title="Onde ficam armazenados">
        <p>Os dados ficam no Supabase (banco Postgres e Storage privado). Os áudios ficam em armazenamento privado, com acesso restrito ao dono, e são excluídos no prazo escolhido em Configurações (3 dias por padrão).</p>
      </DocSection>
      <DocSection title="Provedores de IA">
        <p>O áudio é enviado a serviços de transcrição (Groq e AssemblyAI) e o texto a modelos Claude (Anthropic), apenas para gerar os resultados. As chaves ficam no servidor e suas informações nunca são expostas publicamente.</p>
      </DocSection>
      <DocSection title="Compartilhamento">
        <p>Suas notas só são compartilhadas quando você decide: enviando uma cópia a um colega cadastrado (sem o áudio) ou exportando. Não vendemos seus dados.</p>
      </DocSection>
      <DocSection title="Segurança">
        <p>Acesso restrito por autenticação e regras por linha (RLS): cada usuário acessa apenas os próprios dados. O administrador vê números agregados de uso e o registro técnico de erros.</p>
      </DocSection>
      <DocSection title="LGPD e seus direitos">
        <p>Você pode acessar, corrigir e excluir seus dados. Excluir uma nota remove também o áudio associado. Para solicitações, use o Suporte ou fale com o administrador.</p>
      </DocSection>
      <DocSection title="Consentimento de gravação">
        <p>Ao gravar reuniões e ligações, informe as demais partes e obtenha o consentimento delas quando exigido por lei.</p>
      </DocSection>
    </DocPage>
  )
}
