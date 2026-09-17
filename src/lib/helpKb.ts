// Base de perguntas e respostas sobre o uso do app (mesma da Central de ajuda).
// Usada para responder localmente (sem custo de IA) quando ha correspondencia, e como contexto da
// IA quando nao ha. Revisada em 17/09/2026: tinha o Discador (removido), limites antigos (video de
// 25 MB, audio guardado por 14 dias) e texto sem acento.

export interface HelpEntry {
  q: string
  a: string
  keywords: string[]
}

export const HELP_KB: HelpEntry[] = [
  {
    q: 'Como crio uma nota?',
    a: 'Toque no microfone (no celular, no centro da barra de baixo; no computador, em "Gravação Inteligente") e escolha: gravar pelo microfone, gravar reunião no PC, enviar áudio, enviar vídeo, PDF/arquivo/texto, imagem ou link. A transcrição e o resumo são gerados automaticamente.',
    keywords: ['criar', 'nota', 'nova', 'comecar', 'gravar', 'como', 'faco'],
  },
  {
    q: 'Como gravar uma reunião com a voz das outras pessoas?',
    a: 'No computador, use "Gravar reunião no PC". No app ANA para Windows ele capta o som do computador inteiro (Teams, Zoom, WhatsApp, Meet) mais o seu microfone — a chamada precisa estar tocando no PC. No navegador, escolha a aba da reunião e deixe marcado "Compartilhar também o áudio da guia". No celular isso não é possível: o Android e o iOS não deixam nenhum app captar o áudio de uma chamada de outro app; use o viva-voz e grave pelo microfone.',
    keywords: ['reuniao', 'audio', 'interno', 'zoom', 'meet', 'teams', 'chamada', 'fone', 'sistema', 'aba', 'voz'],
  },
  {
    q: 'Apareceu "Estou gravando só a sua voz". O que faço?',
    a: 'O som da reunião não está chegando. No app Windows: confira se você ouve a outra pessoa pelo computador, veja no ícone de som da barra do Windows qual saída está marcada e deixe o alto-falante do Teams/Zoom/Meet em "Padrão do sistema". Depois toque em "Tentar captar o áudio do PC". No navegador: toque em "Adicionar áudio da reunião", escolha a aba da reunião e ligue "Compartilhar também o áudio da guia". Sua voz continua sendo gravada enquanto isso.',
    keywords: ['so', 'sua', 'voz', 'ausente', 'mudo', 'sistema', 'captar', 'outra', 'pessoa'],
  },
  {
    q: 'Os campos título, tema e contexto são obrigatórios?',
    a: 'Não, todos são opcionais. Sem eles a IA gera a transcrição e o resumo normalmente. O tema e o contexto só ajudam a IA a analisar no formato certo (entrevista, reunião, alinhamento).',
    keywords: ['campos', 'obrigatorio', 'titulo', 'tema', 'contexto', 'opcional'],
  },
  {
    q: 'O que é identificar quem falou?',
    a: 'É uma opção que você liga antes de processar para separar as falas na transcrição (Falante A, Falante B...). Quando a própria conversa mostra quem é quem (a pessoa se apresenta, ou é chamada pelo nome e responde), o ANA troca o rótulo pelo nome; sem essa prova, não adivinha. Na aba Transcrição, em "Quem falou", dá para ver a prova de cada nome, procurar de novo e dar ou corrigir nomes à mão. Leva um pouco mais de tempo.',
    keywords: ['quem', 'falou', 'diarizacao', 'falantes', 'separar'],
  },
  {
    q: 'Como compartilho uma nota?',
    a: 'Dentro da nota, toque em "Compartilhar": WhatsApp, e-mail, PDF, Word, copiar, baixar áudio ou transcrição — ou enviar uma cópia para um amigo cadastrado no ANA.',
    keywords: ['compartilhar', 'enviar', 'whatsapp', 'pdf', 'word', 'email', 'amigo', 'exportar'],
  },
  {
    q: 'Como edito o título ou o resumo de uma nota?',
    a: 'Dentro da nota, toque nos três pontinhos ao lado de "Compartilhar" e escolha "Editar título", "Editar resumo" ou "Copiar nota".',
    keywords: ['editar', 'titulo', 'resumo', 'alterar', 'copiar', 'pontinhos'],
  },
  {
    q: 'Como traduzo uma nota?',
    a: 'Dentro da nota, toque em "Traduzir", escolha o idioma e a IA traduz o resumo. Dá para copiar o resultado.',
    keywords: ['traduzir', 'idioma', 'ingles', 'espanhol', 'traducao'],
  },
  {
    q: 'Como uso as pastas?',
    a: 'Toque no ícone de pasta no topo da tela de notas para criar pastas (com nome e cor), editar ou excluir. Dentro de cada nota, use "Adicionar a uma pasta" — dá para criar a pasta ali mesmo.',
    keywords: ['pasta', 'pastas', 'organizar', 'cor', 'categoria'],
  },
  {
    q: 'Como funcionam as tarefas?',
    a: 'Em "Tarefas" ficam os itens de ação que a IA encontra nas suas reuniões e as tarefas que você cria. Você pode concluir, editar, excluir e marcar a urgência (baixa, normal ou alta) com a bandeirinha, e filtrar por urgência.',
    keywords: ['tarefa', 'tarefas', 'itens', 'acao', 'pendencia', 'urgencia', 'prioridade', 'concluir'],
  },
  {
    q: 'Por quanto tempo o áudio fica guardado?',
    a: 'Por padrão o áudio é excluído automaticamente em 3 dias; a transcrição e o resumo ficam guardados para sempre. Em Configurações → Exclusão automática do áudio você escolhe 3, 7 ou 14 dias, e em cada nota pode ligar "Manter áudio para sempre".',
    keywords: ['audio', 'guardado', 'retencao', 'excluido', 'apagar', 'tempo', 'dias', 'manter'],
  },
  {
    q: 'Como pergunto à IA sobre todas as minhas reuniões?',
    a: 'Na tela de notas, use "Conversar com todas as reuniões" e pergunte em linguagem natural — a IA responde consultando o conteúdo de todas as suas notas.',
    keywords: ['perguntar', 'buscar', 'todas', 'reunioes', 'semantica', 'procurar'],
  },
  {
    q: 'Como exporto meus dados?',
    a: 'Em Configurações → Meus dados → "Exportar meus dados": baixa todas as suas notas num arquivo pequeno, bom para guardar, abrir no Word ou colar em outra IA.',
    keywords: ['exportar', 'backup', 'dados', 'markdown', 'baixar', 'salvar'],
  },
  {
    q: 'Como altero minha foto e nome?',
    a: 'Em Configurações, toque no seu cartão de perfil (foto e nome) para abrir "Editar perfil".',
    keywords: ['foto', 'perfil', 'nome', 'avatar', 'alterar', 'mudar'],
  },
  {
    q: 'Como falo com o suporte?',
    a: 'Em Configurações → Falar com o suporte. Abra um chamado escolhendo o tema (Financeiro, Técnico, Feedback ou Outros).',
    keywords: ['suporte', 'ajuda', 'chamado', 'ticket', 'problema', 'contato'],
  },
  {
    q: 'Como envio um vídeo ou um arquivo de áudio grande?',
    a: 'Em "Nova nota", escolha "Enviar vídeo" ou "Enviar áudio". A IA usa só o som; o vídeo não é armazenado. O limite é 60 MB e 2 horas por arquivo — se passar, converta para MP3 ou divida em partes.',
    keywords: ['video', 'enviar', 'transcrever', 'extrair', 'grande', 'arquivo', 'limite', 'mb'],
  },
  {
    q: 'Existe atalho para gravar no computador?',
    a: 'Sim. No app ANA para Windows, Ctrl+Shift+G traz o app para frente e já começa a gravar a reunião do PC.',
    keywords: ['atalho', 'teclado', 'ctrl', 'windows', 'rapido', 'gravar'],
  },
  {
    q: 'Apareceu que a IA está indisponível. Perdi minha gravação?',
    a: 'Não. A gravação e a transcrição ficam salvas e o administrador já é avisado automaticamente. Quando o serviço voltar, abra a nota e toque em gerar o resumo.',
    keywords: ['indisponivel', 'erro', 'perdi', 'gravacao', 'administrador', 'resumo', 'falhou'],
  },
]

/** Concatena a base para dar contexto a IA (fallback). */
export const HELP_KB_TEXT = HELP_KB.map((e) => `P: ${e.q}\nR: ${e.a}`).join('\n\n')

const STOP = new Set(['como', 'para', 'que', 'uma', 'meu', 'minha', 'the', 'de', 'do', 'da', 'e', 'o', 'a'])

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Busca local por palavras-chave. Retorna a melhor resposta se houver boa correspondencia. */
export function searchHelp(query: string): HelpEntry | null {
  const words = fold(query)
    .split(/\W+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
  if (words.length === 0) return null
  let best: HelpEntry | null = null
  let bestScore = 0
  for (const e of HELP_KB) {
    const hay = fold(e.q + ' ' + e.keywords.join(' '))
    let score = 0
    for (const w of words) if (hay.includes(w)) score++
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  return bestScore >= 2 ? best : null
}
