import { DocPage, DocSection } from './DocPage'

export function Terms() {
  return (
    <DocPage title="Termos de serviço">
      <p className="text-sm text-content-muted">Última atualização: setembro de 2026 · uso interno Tailor.</p>

      <DocSection title="1. Aceitação">
        <p>Ao usar o ANA by Tailor ("aplicativo"), você concorda com estes Termos. O acesso é restrito a colaboradores com e-mail @tailorexec.com.br.</p>
      </DocSection>
      <DocSection title="2. Uso da plataforma">
        <p>O aplicativo grava, transcreve, resume e organiza reuniões e áudios. Você é responsável pelo conteúdo que grava e por obter o consentimento das pessoas envolvidas antes de gravar, conforme a legislação aplicável (LGPD).</p>
      </DocSection>
      <DocSection title="3. Conta e segurança">
        <p>Você é responsável por manter a confidencialidade das suas credenciais. Avise o administrador em caso de uso não autorizado.</p>
      </DocSection>
      <DocSection title="4. Conteúdo e propriedade">
        <p>O conteúdo das suas notas pertence a você e à organização. O aplicativo processa esse conteúdo (transcrição, resumo, análise) apenas para prestar o serviço.</p>
      </DocSection>
      <DocSection title="5. Inteligência artificial">
        <p>Resumos, análises e sugestões são gerados por IA e podem conter imprecisões. Revise informações importantes antes de tomar decisões.</p>
      </DocSection>
      <DocSection title="6. Uso aceitável">
        <p>É proibido usar o aplicativo para fins ilegais, gravar sem consentimento quando exigido ou tentar comprometer a segurança do sistema.</p>
      </DocSection>
      <DocSection title="7. Retenção">
        <p>Os arquivos de áudio são excluídos automaticamente depois do prazo escolhido em Configurações (3, 7 ou 14 dias; 3 dias por padrão), salvo nas notas marcadas para manter o áudio. Transcrições, resumos e informações continuam na sua conta.</p>
      </DocSection>
      <DocSection title="8. Limitação de responsabilidade">
        <p>O aplicativo é fornecido "como está". Não nos responsabilizamos por perdas decorrentes do uso, na máxima extensão permitida por lei.</p>
      </DocSection>
      <DocSection title="9. Contato">
        <p>Dúvidas: abra um chamado em Configurações → Falar com o suporte, ou fale com o administrador.</p>
      </DocSection>
    </DocPage>
  )
}
