// Texto gerado pela IA pode trazer marcacao (##, -, **) que faz sentido no leitor completo
// (SummaryView, em components/NoteContent.tsx) mas nao em previas curtas (cards, listas): ali a marcacao so
// aparece como caractere literal na tela. Aqui centralizamos a limpeza pros dois usos.

/** Remove enfase inline (negrito/italico/codigo) escapada pela IA mesmo quando instruida a nao usar. */
export function stripInlineMd(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}

/** Previa em texto puro (uma linha/paragrafo curto): tira marcadores de titulo/bullet linha a
 *  linha e junta tudo, para caber num card sem sobrar "#"/"-"/"**" no meio do texto. */
export function toPreviewText(text: string | null | undefined): string {
  if (!text?.trim()) return ''
  return text
    .split('\n')
    // Titulos de secao ("## Visão geral") nao entram na previa: so poluiam o card.
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => stripInlineMd(line.trim().replace(/^[-*•]\s+/, '')))
    .filter(Boolean)
    .join(' · ')
}
