/**
 * dataCache.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cache en mémoire Stale-While-Revalidate (SWR) pour éliminer les temps
 * de chargement et afficher les données instantanément (0ms de latence)
 * lors de la navigation entre les pages.
 */

const _cache = new Map();
const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Récupère une valeur du cache mémoire.
 * @param {string} key
 * @returns {any|null}
 */
export function getCached(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    return entry.data;
}

/**
 * Vérifie si la donnée en cache est encore fraîche.
 * @param {string} key
 * @param {number} [maxAgeMs]
 * @returns {boolean}
 */
export function isCacheFresh(key, maxAgeMs = DEFAULT_TTL_MS) {
    const entry = _cache.get(key);
    if (!entry) return false;
    return (Date.now() - entry.timestamp) < maxAgeMs;
}

/**
 * Enregistre une valeur dans le cache mémoire.
 * @param {string} key
 * @param {any} data
 */
export function setCached(key, data) {
    _cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Invalide une clé spécifique ou tout le cache.
 * @param {string} [key]
 */
export function invalidateCache(key) {
    if (key) {
        _cache.delete(key);
    } else {
        _cache.clear();
    }
}

