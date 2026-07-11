const DESKTOP_COLUMNS = 4;

export function getTargetFeedSize(creatorCount) {
  if (creatorCount <= 0) return 0;
  return Math.min(20, (creatorCount + 1) * DESKTOP_COLUMNS);
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
