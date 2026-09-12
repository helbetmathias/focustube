const normalize = value => String(value || '').trim().toLocaleLowerCase();

function relevanceScore(result, normalizedQuery) {
  if (!normalizedQuery) return 0;

  const title = normalize(result.title);
  const author = normalize(result.author);
  if (title === normalizedQuery || author === normalizedQuery) return 2;
  if (title.startsWith(normalizedQuery)) return 1;
  return 0;
}

export function prepareSearchResults(results, query) {
  if (!Array.isArray(results)) return [];

  const seen = new Set();
  const normalizedQuery = normalize(query);
  const includesPlaylistKeyword = /\bplaylists?\b/i.test(String(query || ''));
  return results
    .filter(result => {
      if (!result?.id) return false;
      if (result.type === 'playlist' && !includesPlaylistKeyword) return false;
      const key = `${result.type || 'video'}:${result.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((result, index) => ({ result, index, score: relevanceScore(result, normalizedQuery) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(entry => entry.result);
}

export function getInitialSearchResultCount(total, batchSize = 6) {
  if (total <= batchSize) return total;
  return total - (total % batchSize);
}
