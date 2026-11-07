const TRAKT = 'https://api.trakt.tv';
const TMDB = 'https://api.themoviedb.org/3';

async function jsonFetch(url, opts = {}, fetcher = fetch) {
  const result = await fetcher(url, opts);
  let body;
  try { body = await result.json(); } catch { body = null; }
  if (!result.ok) {
    const error = new Error(`Provider response ${result.status}`);
    error.status = result.status;
    error.body = body;
    throw error;
  }
  return { body, headers: result.headers };
}

export function traktHeaders(env, token) {
  return { 'content-type':'application/json', 'trakt-api-version':'2', 'trakt-api-key':env.TRAKT_CLIENT_ID, ...(token ? { authorization:`Bearer ${token}` } : {}) };
}

export async function requestDeviceCode(env, fetcher = fetch) {
  if (!env.TRAKT_CLIENT_ID) throw new Error('TRAKT_CLIENT_ID missing');
  const {body} = await jsonFetch(`${TRAKT}/oauth/device/code`, {method:'POST', headers:traktHeaders(env), body:JSON.stringify({client_id:env.TRAKT_CLIENT_ID})}, fetcher);
  if (!body?.device_code || !body?.user_code || !body?.verification_url) throw new Error('Unexpected Trakt device response');
  return body;
}

export async function redeemDeviceCode(env, code, fetcher = fetch) {
  const payload = { code, client_id:env.TRAKT_CLIENT_ID, ...(env.TRAKT_CLIENT_SECRET ? {client_secret:env.TRAKT_CLIENT_SECRET} : {}) };
  return (await jsonFetch(`${TRAKT}/oauth/device/token`, {method:'POST', headers:traktHeaders(env), body:JSON.stringify(payload)}, fetcher)).body;
}

export async function refreshTraktToken(env, token, fetcher = fetch) {
  const payload = { refresh_token:token.refresh_token, client_id:env.TRAKT_CLIENT_ID, grant_type:'refresh_token', redirect_uri:'urn:ietf:wg:oauth:2.0:oob', ...(env.TRAKT_CLIENT_SECRET?{client_secret:env.TRAKT_CLIENT_SECRET}:{}) };
  return (await jsonFetch(`${TRAKT}/oauth/token`, {method:'POST',headers:traktHeaders(env),body:JSON.stringify(payload)}, fetcher)).body;
}

/** Fetches tracked viewing events, respecting pagination response headers. */
export async function getHistory(env, token, type, { fetcher=fetch, maxPages=4, pageSize=100 } = {}) {
  const events = [];
  let truncated = false;
  for (let page=1;page<=maxPages;page++) {
    const {body,headers} = await jsonFetch(`${TRAKT}/sync/history/${type}?page=${page}&limit=${pageSize}`, {headers:traktHeaders(env,token)}, fetcher);
    if (!Array.isArray(body)) throw new Error('Unexpected Trakt history response');
    events.push(...body);
    const pageCount = Number(headers.get('X-Pagination-Page-Count'));
    if (Number.isInteger(pageCount) && pageCount>0) {
      if (page>=pageCount) break;
      if (page===maxPages) truncated=true;
    } else if (body.length<pageSize) {
      break;
    } else if (page===maxPages) truncated=true;
  }
  return {events, truncated};
}

/** /sync/watched is a per-title summary, more useful than episodic history for exclusion. */
export async function getWatched(env, token, type, { fetcher=fetch, maxPages=3, pageSize=250 } = {}) {
  const entries=[];
  let truncated=false;
  for(let page=1;page<=maxPages;page++) {
    const {body,headers}=await jsonFetch(`${TRAKT}/sync/watched/${type}?page=${page}&limit=${pageSize}`,
      {headers:traktHeaders(env,token)},fetcher);
    if(!Array.isArray(body))throw Error('Unexpected Trakt watched response');
    entries.push(...body);
    const total=Number(headers.get('X-Pagination-Page-Count'));
    if(Number.isInteger(total)&&total>0) {
      if(page>=total)break;
      if(page===maxPages)truncated=true;
    } else if(body.length<pageSize)break;
    else if(page===maxPages)truncated=true;
  }
  return {events:entries,truncated};
}

export async function getTmdb(env, path, fetcher=fetch) {
  if (!env.TMDB_READ_TOKEN) throw new Error('TMDB_READ_TOKEN missing');
  const url = `${TMDB}${path}${path.includes('?') ? '&' : '?'}language=fr-FR`;
  return (await jsonFetch(url, {headers:{authorization:`Bearer ${env.TMDB_READ_TOKEN}`,accept:'application/json'}},fetcher)).body;
}

export function parsedHistory(events, type) {
  const index = new Map();
  for (const e of events) {
    const item = type === 'movie' ? e?.movie : e?.show;
    const tmdb = Number(item?.ids?.tmdb);
    if (!Number.isSafeInteger(tmdb) || tmdb<=0) continue;
    const date = e.watched_at || e.last_watched_at || '';
    const prev = index.get(tmdb);
    if (!prev || date > prev.date) index.set(tmdb, {tmdbId:tmdb,date,name:item.title,imdbId:item.ids?.imdb,type});
  }
  return [...index.values()].sort((a,b)=>b.date.localeCompare(a.date));
}
