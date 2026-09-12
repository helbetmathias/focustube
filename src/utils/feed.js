const DESKTOP_COLUMNS = 4;

export function getContinueWatchingItems(history, limit = DESKTOP_COLUMNS) {
  if (!Array.isArray(history) || limit <= 0) return [];

  const seenIds = new Set();
  return [...history]
    .sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0))
    .filter(item => {
      const progress = Number(item?.progress) || 0;
      const duration = Number(item?.duration) || 0;
      if (!item?.id || seenIds.has(item.id) || progress <= 0 || duration <= 0) return false;

      seenIds.add(item.id);
      return progress / duration < 0.95;
    })
    .slice(0, limit);
}

export function getHomeHistoryContext(history, creatorLimit = 4) {
  const sortedHistory = Array.isArray(history)
    ? [...history].sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0))
    : [];
  const creators = [];
  const seenCreators = new Set();

  for (const item of sortedHistory) {
    const author = item.author?.trim();
    const key = author?.toLocaleLowerCase();
    if (!key || seenCreators.has(key)) continue;
    seenCreators.add(key);
    creators.push(author);
    if (creators.length >= creatorLimit) break;
  }

  const newestSeed = sortedHistory[0] || null;
  const signature = JSON.stringify({
    creators: creators.map(creator => creator.toLocaleLowerCase()),
    seedVideoId: newestSeed?.id || null,
  });

  return { sortedHistory, creators, newestSeed, signature };
}

export function getTargetFeedSize(creatorCount) {
  if (creatorCount <= 0) return 0;
  return Math.min(20, (creatorCount + 1) * DESKTOP_COLUMNS);
}

export function getCompactTargetFeedSize(creatorCount) {
  const desktopTarget = getTargetFeedSize(creatorCount);
  return desktopTarget > 0 ? Math.ceil(desktopTarget / 3) * 3 : 0;
}

export function getHomeFeedPoolSize(creatorCount) {
  const largestTarget = Math.max(
    getTargetFeedSize(creatorCount),
    getCompactTargetFeedSize(creatorCount)
  );
  return largestTarget > 0 ? Math.ceil(largestTarget / DESKTOP_COLUMNS) * DESKTOP_COLUMNS : 0;
}

function arrangeGroups(groupedItems, random = Math.random) {
  const queues = groupedItems
    .map((items, groupIndex) => ({ groupIndex, items: [...items], used: 0 }))
    .filter(group => group.items.length > 0);
  const arranged = [];
  const arrangedGroups = [];

  while (queues.some(group => group.items.length > 0)) {
    const position = arranged.length;
    const column = position % DESKTOP_COLUMNS;
    const previousGroup = column > 0 ? arrangedGroups[position - 1] : null;
    const groupAbove = position >= DESKTOP_COLUMNS ? arrangedGroups[position - DESKTOP_COLUMNS] : null;
    const candidates = queues.filter(group => group.items.length > 0);

    const scored = candidates.map(group => {
      let penalty = group.used * 10;
      if (group.groupIndex === groupAbove) penalty += 100;
      if (group.groupIndex === previousGroup) penalty += 1000;
      return { group, penalty };
    });
    const lowestPenalty = Math.min(...scored.map(candidate => candidate.penalty));
    const bestCandidates = scored.filter(candidate => candidate.penalty === lowestPenalty);
    const selected = bestCandidates[Math.floor(random() * bestCandidates.length)].group;

    arranged.push(selected.items.shift());
    arrangedGroups.push(selected.groupIndex);
    selected.used += 1;
  }

  return arranged;
}

export function buildBalancedCreatorFeed(creatorVideoGroups, targetFeedSize, random = Math.random) {
  const taggedGroups = creatorVideoGroups.map((videos, groupIndex) =>
    videos.map(video => ({ video, groupIndex }))
  );
  const arranged = arrangeGroups(taggedGroups, random);
  const creatorFeed = [];
  const creatorIds = new Set();

  for (const entry of arranged) {
    if (!creatorIds.has(entry.video.id)) {
      creatorIds.add(entry.video.id);
      creatorFeed.push(entry.video);
    }
  }

  const completeCardCount = Math.floor(Math.min(targetFeedSize, creatorFeed.length) / DESKTOP_COLUMNS) * DESKTOP_COLUMNS;
  return {
    visibleFeed: creatorFeed.slice(0, completeCardCount),
    reserveFeed: creatorFeed.slice(completeCardCount),
    creatorIds
  };
}

export function blendRecommendationSources(creatorFeed, realFeed, random = Math.random) {
  if (creatorFeed.length === 0 || realFeed.length === 0) return [...creatorFeed];

  const selectedReal = realFeed.slice(0, Math.floor(creatorFeed.length / 2));
  const selectedCreators = creatorFeed.slice(0, creatorFeed.length - selectedReal.length);
  const combined = [...selectedCreators, ...selectedReal];
  const groupsByAuthor = new Map();

  for (const video of combined) {
    const groupKey = video.author?.trim().toLowerCase() || video.id;
    if (!groupsByAuthor.has(groupKey)) groupsByAuthor.set(groupKey, []);
    groupsByAuthor.get(groupKey).push(video);
  }

  return arrangeGroups([...groupsByAuthor.values()], random).slice(0, creatorFeed.length);
}
