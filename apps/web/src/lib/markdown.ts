// Mini-rendu Markdown SUR : on echappe tout le HTML d'abord, puis on applique
// des transformations qui ne produisent que des balises connues. Pas d'injection.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Placeholders en zone Unicode privee (n'apparaissent jamais dans du vrai texte).
const OPEN = String.fromCharCode(0xe000);
const CLOSE = String.fromCharCode(0xe001);

export function renderMarkdown(src: string): string {
  const blocks: string[] = [];
  // 1) blocs de code entoures de triple backtick (extraits AVANT echappement)
  let t = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code: string) => {
    const i = blocks.length;
    blocks.push('<pre class="md-pre"><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
    return OPEN + i + CLOSE;
  });
  // 2) echappe le reste
  t = esc(t);
  // 3) code inline
  t = t.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  // 4) gras / italique
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // 5) titres
  t = t.replace(/^#{1,3}\s+(.+)$/gm, '<div class="md-h">$1</div>');
  // 6) liens [texte](http...)
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="md-link">$1</a>');
  // 7) puces
  t = t.replace(/^(\s*)[-*]\s+(.+)$/gm, '$1• $2');
  // 8) sauts de ligne du texte courant (AVANT de reinjecter les blocs <pre>)
  t = t.replace(/\n/g, '<br/>');
  // 9) restaure les blocs de code (qui gardent leurs sauts de ligne internes)
  t = t.replace(new RegExp(OPEN + '(\\d+)' + CLOSE, 'g'), (_m, i: string) => blocks[Number(i)] ?? '');
  return t;
}
