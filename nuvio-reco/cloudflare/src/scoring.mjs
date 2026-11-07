/** Deterministic, local-only recommendation scoring (no generative AI). */
export const LANES = [
  ['for-you', 'Pour vous'],
  ['because-watched', 'Parce que vous avez regardé…'],
  ['daily', 'Votre sélection du jour'],
];

export function fingerprint(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export function normalizeTmdb(movie, type) {
  if (!movie || !Number.isInteger(Number(movie.id)) || !movie.poster_path) return null;
  return {
    tmdbId: Number(movie.id),
    type,
    name: String(movie.title || movie.name || movie.original_title || movie.original_name || '').slice(0, 200),
    poster: `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
    background: movie.backdrop_path ? `https://image.tmdb.org/t/p/w780${movie.backdrop_path}` : undefined,
    description: String(movie.overview || '').slice(0, 1800),
    rating: Number(movie.vote_average || 0),
    votes: Number(movie.vote_count || 0),
    genres: (movie.genre_ids || movie.genres?.map(g=>g.id) || []).map(Number),
    imdbId: typeof movie.imdb_id === 'string' && /^tt\d+$/.test(movie.imdb_id) ? movie.imdb_id : undefined,
    releaseInfo: String((movie.release_date || movie.first_air_date || '').slice(0, 4)),
  };
}

export function rankCandidates({ candidates, type, lane, profileId, day, watched = [], favorites = [], genreWeights = {}, reasonGenres = [] }) {
  const seen = new Set(watched.map(Number));
  const loved = new Set(favorites.map(Number));
  const reason = new Set(reasonGenres.map(Number));
  const unique = new Map();
  for (const c of candidates) {
    if (!c || c.type !== type || seen.has(c.tmdbId) || !c.poster || !c.name) continue;
    const genres = c.genres || [];
    const taste = genres.reduce((sum, g) => sum + (Number(genreWeights[g]) || 0), 0);
    const similarity = genres.filter(g => reason.has(g)).length;
    const quality = Math.min(10, Number(c.rating) || 0) + Math.log2(1 + (c.votes || 0)) * .17;
    const jitter = fingerprint(`${profileId}:${day}:${c.tmdbId}`);
    const score = lane === 'daily' ? taste * .3 + quality * .6 + jitter * 7
      : lane === 'because-watched' ? similarity * 12 + taste * .3 + quality + jitter
      : taste * 3 + similarity * 1.4 + quality + jitter * 1.5;
    const prior = unique.get(c.tmdbId);
    if (!prior || score > prior.score) unique.set(c.tmdbId, { ...c, score, loved: loved.has(c.tmdbId) });
  }
  return [...unique.values()].sort((a,b) => b.score - a.score || a.tmdbId - b.tmdbId);
}

export function toStremioMeta(candidate) {
  const id = candidate.imdbId || `tmdb:${candidate.tmdbId}`;
  return {
    id,
    type: candidate.type,
    name: candidate.name,
    poster: candidate.poster,
    ...(candidate.background ? { background: candidate.background } : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
    ...(candidate.releaseInfo ? { releaseInfo: candidate.releaseInfo } : {}),
  };
}
