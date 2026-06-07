import { get, set } from 'idb-keyval';

// History Storage (IndexedDB)
// Unlimited capacity, async
export const getHistory = async () => {
  try {
    const history = await get('puretube_history');
    return history || [];
  } catch (error) {
    console.error('Failed to get history from IndexedDB:', error);
    return [];
  }
};

export const saveHistory = async (historyArray) => {
  try {
    await set('puretube_history', historyArray);
  } catch (error) {
    console.error('Failed to save history to IndexedDB:', error);
  }
};

export const clearHistory = async () => {
  try {
    await set('puretube_history', []);
  } catch (error) {
    console.error('Failed to clear history in IndexedDB:', error);
  }
};

// For settings like time saved that we might update very frequently
export const getTimeSaved = async () => {
  try {
    const time = await get('puretube_time_saved');
    return time || 0;
  } catch (error) {
    return 0;
  }
};

export const saveTimeSaved = async (timeSavedSeconds) => {
  try {
    await set('puretube_time_saved', timeSavedSeconds);
  } catch (error) {
    console.error('Failed to save time to IndexedDB:', error);
  }
};

// Feed Cache
export const getFeedCache = async () => {
  try {
    const feed = await get('puretube_feed_cache');
    return feed || [];
  } catch (error) {
    return [];
  }
};

export const saveFeedCache = async (feedArray) => {
  try {
    await set('puretube_feed_cache', feedArray);
  } catch (error) {
    console.error('Failed to save feed cache to IndexedDB:', error);
  }
};

export const getHomeBlendCache = async () => {
  try {
    const feed = await get('puretube_home_blend');
    return feed || [];
  } catch (error) {
    return [];
  }
};

export const saveHomeBlendCache = async (feedArray) => {
  try {
    await set('puretube_home_blend', feedArray);
  } catch (error) {
    console.error('Failed to save home blend to IndexedDB:', error);
  }
};
