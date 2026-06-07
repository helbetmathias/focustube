const SPONSORBLOCK_API = 'https://sponsor.ajay.app/api/skipSegments';

export async function fetchSkipSegments(videoId) {
  try {
    const categories = '["sponsor","intro","outro","interaction","selfpromo","music_offtopic","poi_highlight"]';
    const actionTypes = '["skip","mute","poi"]';
    const response = await fetch(`${SPONSORBLOCK_API}?videoID=${videoId}&categories=${encodeURIComponent(categories)}&actionTypes=${encodeURIComponent(actionTypes)}`);

    if (!response.ok) {
      if (response.status === 404) {
        return []; // No segments found for this video
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch SponsorBlock segments:', error);
    return [];
  }
}
