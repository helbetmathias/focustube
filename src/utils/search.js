const normalize = value => String(value || '').trim().toLocaleLowerCase();

const isShortsToken = token => /^#?shorts?$/i.test(
  String(token || '').replace(/^[,;:!?]+|[,;:!?]+$/g, '')
);

export function getSearchIntent(query) {
  const tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
  const wantsShorts = tokens.some(isShortsToken);
  const searchQuery = tokens.filter(token => !isShortsToken(token)).join(' ');

  return { searchQuery, wantsShorts };
}

export function queryRequestsShorts(query) {
  return getSearchIntent(query).wantsShorts;
}

export function filterKnownShorts(results) {
  if (!Array.isArray(results)) return [];
  return results.filter(result => result?.isShort !== true);
}

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
  const { searchQuery, wantsShorts } = getSearchIntent(query);
  const normalizedQuery = normalize(searchQuery);
  const includesPlaylistKeyword = /\bplaylists?\b/i.test(String(query || ''));
  return results
    .filter(result => {
      if (!result?.id) return false;
      if (result.type === 'playlist' && !includesPlaylistKeyword) return false;
      if (wantsShorts ? result.isShort !== true : result.isShort === true) return false;
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
