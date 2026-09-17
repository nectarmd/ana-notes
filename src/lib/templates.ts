// "Tema" da nota: ajuda a IA a resumir/analisar no formato certo daquele tipo.

export type NoteTemplate = 'geral' | 'entrevista' | 'reuniao' | 'alinhamento' | 'outros'

export const TEMPLATES: { id: NoteTemplate; label: string; hint: string }[] = [
  { id: 'geral', label: 'Geral', hint: 'Resumo padrão do conteúdo.' },
  {
    id: 'entrevista',
    label: 'Entrevista',
    hint: 'Competências, fit cultural, pontos fortes/de atenção e recomendação.',
  },
  {
    id: 'reuniao',
    label: 'Reuniao',
    hint: 'Decisões, próximos passos, dores/oportunidades e responsáveis.',
  },
  { id: 'alinhamento', label: 'Alinhamento', hint: 'Combinados, responsaveis e follow-ups.' },
  { id: 'outros', label: 'Outros', hint: 'Resumo geral do conteúdo.' },
]

export function templateLabel(id: string | null | undefined): string {
  return TEMPLATES.find((t) => t.id === id)?.label ?? 'Geral'
}
