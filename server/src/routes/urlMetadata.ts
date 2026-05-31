// URL metadata — GET /url-metadata?url=…  (PD.63)
//
// Fetches a URL server-side (CORS-free), extracts <title>, og:image,
// description, and favicon, returns JSON. The client uses this to
// render link cards inline when a URL is pasted into a doc body or
// the Links list.
//
// Why server-side: browser fetch can't reach arbitrary origins without
// CORS. The server has no such limit.
//
// Caching: an in-memory LRU keyed by URL with a 1-hour TTL. Plenty for
// the "user pasted the same article on phone and laptop" pattern; not
// memory-intensive (we cap at 200 entries). Survives across requests
// only within a single process — fine for the deployment shape.
//
// Failure modes:
//   - Upstream returns 4xx/5xx → 200 { title: null, error: "..." }
//   - Upstream content-type isn't text/html → 200 with title = hostname
//   - Timeout (5s) → same as upstream error
// The client tolerates all of these and just shows the URL.

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../lib/auth.js';

const urlMetadataApi = new Hono<AuthContext>();
urlMetadataApi.use('*', requireAuth);

type Meta = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  domain: string;
  fetchedAt: number;
};

const CACHE = new Map<string, Meta>();
const CACHE_MAX = 200;
const TTL_MS = 60 * 60 * 1000;

function pickMeta(html: string, baseUrl: URL): Omit<Meta, 'url' | 'fetchedAt' | 'domain'> {
  // First 200KB only — pages with massive <body> won't help us anyway.
  const head = html.slice(0, 200_000);
  function attr(re: RegExp): string | null {
    const m = re.exec(head);
    return m && m[1] ? m[1].trim() : null;
  }
  // og:title preferred, then <title>, then twitter:title.
  const ogTitle = attr(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
                ?? attr(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const docTitle = attr(/<title[^>]*>([^<]+)<\/title>/i);
  const twTitle = attr(/<meta\s+[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i);
  const title = (ogTitle || docTitle || twTitle || null)?.replace(/\s+/g, ' ').trim() || null;

  const ogDesc = attr(/<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  const metaDesc = attr(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const description = (ogDesc || metaDesc || null)?.replace(/\s+/g, ' ').trim().slice(0, 240) || null;

  const ogImage = attr(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
              ?? attr(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  const image = ogImage ? new URL(ogImage, baseUrl).href : null;

  // Favicon — link rel="icon" first; fall back to /favicon.ico.
  const iconHref = attr(/<link\s+[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/i);
  const favicon = iconHref ? new URL(iconHref, baseUrl).href : new URL('/favicon.ico', baseUrl).href;

  return { title, description, image, favicon };
}

urlMetadataApi.get('/', async (c) => {
  const raw = c.req.query('url');
  if (!raw) return c.json({ error: 'missing url param' }, 400);

  let url: URL;
  try {
    url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) throw new Error('non-http(s)');
  } catch {
    return c.json({ error: 'invalid url' }, 400);
  }

  const cached = CACHE.get(url.href);
  if (cached && (Date.now() - cached.fetchedAt) < TTL_MS) {
    return c.json(cached);
  }

  // Fetch with a tight timeout and a friendly User-Agent.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5000);
  let html = '';
  let ctype = '';
  try {
    const resp = await fetch(url.href, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MaxBot/1.0; +https://travelingwithmax.app)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(t);
    ctype = resp.headers.get('content-type') || '';
    if (ctype.includes('text/html') || ctype.includes('application/xhtml')) {
      html = await resp.text();
    }
  } catch (e) {
    clearTimeout(t);
    // Cache the failure too, so we don't retry hammering a dead URL.
    const fallback: Meta = {
      url: url.href, title: null, description: null, image: null,
      favicon: new URL('/favicon.ico', url).href, domain: url.hostname,
      fetchedAt: Date.now(),
    };
    cachePut(url.href, fallback);
    return c.json(fallback);
  }

  const parsed = html ? pickMeta(html, url) : { title: null, description: null, image: null, favicon: new URL('/favicon.ico', url).href };
  const meta: Meta = {
    url: url.href,
    title: parsed.title,
    description: parsed.description,
    image: parsed.image,
    favicon: parsed.favicon,
    domain: url.hostname,
    fetchedAt: Date.now(),
  };
  cachePut(url.href, meta);
  return c.json(meta);
});

function cachePut(key: string, value: Meta) {
  if (CACHE.size >= CACHE_MAX) {
    // Drop the oldest entry (insertion order).
    const firstKey = CACHE.keys().next().value;
    if (firstKey !== undefined) CACHE.delete(firstKey);
  }
  CACHE.set(key, value);
}

export { urlMetadataApi };
