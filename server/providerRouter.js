import {
  INVIDIOUS_CAPABILITIES,
  INVIDIOUS_INSTANCES,
  PREFERRED_SEARCH_INSTANCE,
} from '../shared/invidious.js';

const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS_PER_REQUEST = 4;
const PROVIDER_BATCH_SIZE = 2;

function shuffle(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function moveToFront(values, provider) {
  if (!provider || !values.includes(provider)) return values;
  return [provider, ...values.filter(value => value !== provider)];
}

function capabilityPath(capability, params) {
  if (capability === INVIDIOUS_CAPABILITIES.SEARCH) {
    return `/api/v1/search?q=${encodeURIComponent(params.query)}&page=1`;
  }
  if (capability === INVIDIOUS_CAPABILITIES.RELATED) {
    return `/api/v1/videos/${encodeURIComponent(params.videoId)}`;
  }
  return `/api/v1/playlists/${encodeURIComponent(params.playlistId)}`;
}

function isValidResponse(capability, data) {
  if (capability === INVIDIOUS_CAPABILITIES.SEARCH) return Array.isArray(data);
  if (capability === INVIDIOUS_CAPABILITIES.RELATED) {
    return Array.isArray(data?.recommendedVideos) && data.recommendedVideos.length > 0;
  }
  return Array.isArray(data?.videos);
}

export function createProviderRouter({
  fetchImpl = fetch,
  instances = INVIDIOUS_INSTANCES,
  random = Math.random,
  now = Date.now,
  timeoutMs = 5000,
} = {}) {
  const randomized = shuffle(instances, random);
  const preferred = new Map();
  const failures = new Map(
    Object.values(INVIDIOUS_CAPABILITIES).map(capability => [capability, new Map()]),
  );

  function orderedProviders(capability) {
    let ordered = moveToFront(randomized, preferred.get(capability));
    if (capability === INVIDIOUS_CAPABILITIES.SEARCH) {
      ordered = moveToFront(ordered, PREFERRED_SEARCH_INSTANCE);
    }

    const currentTime = now();
    const capabilityFailures = failures.get(capability);
    return ordered.filter(provider => {
      const failedAt = capabilityFailures.get(provider);
      if (!failedAt) return true;
      if (currentTime - failedAt >= FAILURE_COOLDOWN_MS) {
        capabilityFailures.delete(provider);
        return true;
      }
      return false;
    }).slice(0, MAX_ATTEMPTS_PER_REQUEST);
  }

  async function fetchProvider(provider, path, capability, controller, trackFailure = true) {
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${provider}${path}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
      const data = await response.json();
      if (!isValidResponse(capability, data)) throw new Error('Provider returned invalid data');
      return { provider, data };
    } catch (error) {
      if (trackFailure && !controller.signal.aborted) failures.get(capability).set(provider, now());
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function request(capability, params) {
    const providers = orderedProviders(capability);
    const path = capabilityPath(capability, params);

    for (let index = 0; index < providers.length; index += PROVIDER_BATCH_SIZE) {
      const batch = providers.slice(index, index + PROVIDER_BATCH_SIZE);
      const controllers = batch.map(() => new AbortController());
      try {
        const result = await Promise.any(batch.map((provider, batchIndex) =>
          fetchProvider(provider, path, capability, controllers[batchIndex])));
        controllers.forEach(controller => controller.abort());
        preferred.set(capability, result.provider);

        if (capability === INVIDIOUS_CAPABILITIES.SEARCH && params.pages === 2) {
          try {
            const pageTwo = await fetchProvider(
              result.provider,
              `/api/v1/search?q=${encodeURIComponent(params.query)}&page=2`,
              capability,
              new AbortController(),
              false,
            );
            result.data = [...result.data, ...pageTwo.data];
          } catch {
            // Page one remains useful if page two is unavailable.
          }
        }

        return result;
      } catch {
        controllers.forEach(controller => controller.abort());
      }
    }

    throw new Error(`No provider could handle ${capability}`);
  }

  return { request };
}
