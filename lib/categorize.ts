// Preprosta heuristika po ključnih besedah (brez AI)
export function categorize(text: string): string {
  const t = (text || '').toLowerCase();
  const has = (...words: string[]) => words.some(w => t.includes(w));

  if (has('vlada','minister','parlament','referendum','volitve','poslanec','premier','janša','golob','ministrstvo'))
    return 'Politika';
  if (has('olimpija','maribor','nzs','nogomet','košarka','kolesar','tour','dirka','tekma','gol','liga'))
    return 'Šport';
  if (has('delnica','borza','inflacija','banka','evro','gospodarstvo','proračun','bdp','davki','podjetje','startup'))
    return 'Gospodarstvo';
  if (has('iphone','android','ai','umetna inteligenca','openai','google','apple','program','aplikacija','tehnologija'))
    return 'Tehnologija';
  if (has('neurje','vreme','poplava','sneg','vihar','temperatura','nevihta','arso'))
    return 'Vreme';
  if (has('glasba','film','serija','zabava','koncert','festival','influencer','zvezda'))
    return 'Zabava';

  return 'Družba';
}

export function makeSnippet(text: string, max = 180): string {
  const s = (text || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
