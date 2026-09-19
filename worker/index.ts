import { Hono, type MiddlewareHandler } from 'hono';
import { basicAuth } from 'hono/basic-auth';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_USER: string;
  ADMIN_PASSWORD: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET: string;
};
type EventRow = {
  id: number;
  title: string;
  start_date: string;
  description: string;
  status: 'published' | 'hidden';
  created_at: string;
  updated_at: string;
};
type EventInput = {
  title?: unknown;
  startDate?: unknown;
  description?: unknown;
  status?: unknown;
  website?: unknown;
  turnstileToken?: unknown;
};
const app = new Hono<{ Bindings: Bindings }>();
const PAGE_SIZE = 20;
const WINDOW_SECONDS = 60;
const MAX_SUBMISSIONS_PER_WINDOW = 5;
const TEST_SECRET = '1x0000000000000000000000000000000AA';

function japanToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > japanToday()) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validInput(body: EventInput) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!title || title.length > 100 || description.length > 300 || !validDate(body.startDate)) return null;
  return { title, description, startDate: body.startDate };
}

async function readInput(c: { req: { json: () => Promise<unknown> } }): Promise<EventInput> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body as EventInput : {};
}

async function hashIp(ip: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function currentWindowStart() {
  return Math.floor(Date.now() / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS;
}

function pruneSubmissionLimits(db: D1Database, windowStart: number) {
  return db.prepare('DELETE FROM submission_rate_limits WHERE window_start < ?')
    .bind(windowStart).run().then(() => undefined, () => undefined);
}

async function withinSubmissionLimit(db: D1Database, ip: string, windowStart: number) {
  const hash = await hashIp(ip);
  const row = await db.prepare(`
    INSERT INTO submission_rate_limits (ip_hash, window_start, count)
    VALUES (?, ?, 1)
    ON CONFLICT(ip_hash) DO UPDATE SET
      window_start = excluded.window_start,
      count = CASE WHEN submission_rate_limits.window_start = excluded.window_start
                   THEN submission_rate_limits.count + 1 ELSE 1 END
    WHERE submission_rate_limits.window_start < excluded.window_start
       OR (submission_rate_limits.window_start = excluded.window_start AND submission_rate_limits.count < ?)
    RETURNING count
  `).bind(hash, windowStart, MAX_SUBMISSIONS_PER_WINDOW).first<{ count: number }>();
  return row !== null;
}

async function verifyTurnstile(token: unknown, secret: string, ip: string, hostname: string) {
  if (typeof token !== 'string' || !token || token.length > 2048 || !secret) return false;
  if (secret === TEST_SECRET && !['localhost', '127.0.0.1'].includes(hostname)) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; hostname?: string };
    return result.success === true && (secret === TEST_SECRET || result.hostname === hostname);
  } catch {
    return false;
  }
}

function pageParam(value: string | undefined) {
  const parsed = Number(value ?? '1');
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100000) : 1;
}

app.get('/api/config', c => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY }, 200, { 'Cache-Control': 'no-store' }));

app.get('/api/events', async c => {
  const page = pageParam(c.req.query('page'));
  const sort = c.req.query('sort') ?? 'new';
  const order = sort === 'days' ? 'start_date ASC, id DESC'
    : sort === 'daysAsc' ? 'start_date DESC, id DESC' : 'created_at DESC, id DESC';
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM events WHERE status = 'published'").first<{ total: number }>();
  const rows = await c.env.DB.prepare(`SELECT id, title, start_date, description, created_at
    FROM events WHERE status = 'published' ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(PAGE_SIZE, (page - 1) * PAGE_SIZE).all<EventRow>();
  return c.json({ events: rows.results ?? [], total: count?.total ?? 0, page, pageSize: PAGE_SIZE });
});

app.post('/api/events', async c => {
  const body = await readInput(c);
  const input = validInput(body);
  if (!input || body.website) return c.json({ error: '名前と開始日を確認してください。' }, 400);
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const hostname = new URL(c.req.url).hostname;
  const windowStart = currentWindowStart();
  if (!(await withinSubmissionLimit(c.env.DB, ip, windowStart))) {
    return c.json({ error: '投稿が多すぎます。少し待ってから再試行してください。' }, 429);
  }
  c.executionCtx.waitUntil(pruneSubmissionLimits(c.env.DB, windowStart));
  if (!(await verifyTurnstile(body.turnstileToken, c.env.TURNSTILE_SECRET, ip, hostname))) {
    return c.json({ error: '認証に失敗しました。もう一度お試しください。' }, 403);
  }
  const result = await c.env.DB.prepare('INSERT INTO events (title, start_date, description) VALUES (?, ?, ?)')
    .bind(input.title, input.startDate, input.description).run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

const adminAuth: MiddlewareHandler<{ Bindings: Bindings }> = (c, next) =>
  basicAuth({ username: c.env.ADMIN_USER, password: c.env.ADMIN_PASSWORD })(c, next);
app.use('/admin', adminAuth);
app.use('/admin/*', adminAuth);
app.get('/admin', async c => {
  const asset = await c.env.ASSETS.fetch(new URL('/index.html', c.req.url));
  const response = new Response(asset.body, asset);
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
app.get('/admin/*', async c => {
  const asset = await c.env.ASSETS.fetch(new URL('/index.html', c.req.url));
  const response = new Response(asset.body, asset);
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

app.use('/api/admin/*', adminAuth);
app.get('/api/admin/events', async c => {
  const page = pageParam(c.req.query('page'));
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM events').first<{ total: number }>();
  const rows = await c.env.DB.prepare('SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .bind(PAGE_SIZE, (page - 1) * PAGE_SIZE).all<EventRow>();
  return c.json({ events: rows.results ?? [], total: count?.total ?? 0, page, pageSize: PAGE_SIZE },
    200, { 'Cache-Control': 'no-store' });
});
app.patch('/api/admin/events/:id', async c => {
  const id = Number(c.req.param('id'));
  const body = await readInput(c);
  const input = validInput(body);
  if (!Number.isSafeInteger(id) || id < 1 || !input || !['published', 'hidden'].includes(String(body.status))) {
    return c.json({ error: '入力内容を確認してください。' }, 400);
  }
  const result = await c.env.DB.prepare("UPDATE events SET title = ?, start_date = ?, description = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(input.title, input.startDate, input.description, body.status, id).run();
  if (!result.meta.changes) return c.json({ error: '投稿が見つかりません。' }, 404);
  return c.json({ ok: true });
});
app.delete('/api/admin/events/:id', async c => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: 'IDが不正です。' }, 400);
  const result = await c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json({ error: '投稿が見つかりません。' }, 404);
  return c.json({ ok: true });
});

export default app;
