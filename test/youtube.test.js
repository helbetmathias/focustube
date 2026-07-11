import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeUrl } from '../src/utils/youtube.js';

test('parses standard, short, Shorts, and playlist URLs', () => {
  assert.equal(parseYouTubeUrl('https://www.youtube.com/watch?v=abc123').videoId, 'abc123');
  assert.equal(parseYouTubeUrl('https://youtu.be/xyz789?t=10').videoId, 'xyz789');
  assert.equal(parseYouTubeUrl('https://www.youtube.com/shorts/short123').videoId, 'short123');
  assert.equal(parseYouTubeUrl('https://www.youtube.com/playlist?list=PL123').playlistId, 'PL123');
});

test('does not accept lookalike YouTube hostnames', () => {
  const result = parseYouTubeUrl('https://notyoutube.com/watch?v=unsafe');
  assert.equal(result.videoId, null);
  assert.equal(result.query, 'https://notyoutube.com/watch?v=unsafe');
});

test('plain text remains a search query', () => {
  assert.equal(parseYouTubeUrl('indila sos').query, 'indila sos');
});
