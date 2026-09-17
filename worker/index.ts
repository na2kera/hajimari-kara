import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';

type Bindings = { DB: D1Database; ADMIN_USER: string; ADMIN_PASSWORD: string };
const WINDOW_SECONDS = 60;
const MAX_SUBMISSIONS_PER_WINDOW = 5;
type EventRow = { id:number; title:string; start_date:string; description:string; status:string; created_at:string; updated_at:string };
const app = new Hono<{ Bindings: Bindings }>();

function japanToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > japanToday()) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

app.get('/api/events', async (c) => {
  const rows = await c.env.DB.prepare("SELECT id,title,start_date,description,created_at,updated_at FROM events WHERE status='published' ORDER BY created_at DESC").all<EventRow>();
  return c.json(rows.results ?? []);
});

async function hashIp(ip: string) { const bytes = new TextEncoder().encode(ip); const digest = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join(''); }
async function withinSubmissionLimit(c: any) { const ip = c.req.header('cf-connecting-ip') || 'unknown'; const hash = await hashIp(ip); const windowStart = Math.floor(Date.now() / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS; const row = await c.env.DB.prepare('SELECT window_start,count FROM submission_rate_limits WHERE ip_hash=?').bind(hash).first() as { window_start: number; count: number } | null; if (row && row.window_start === windowStart && row.count >= MAX_SUBMISSIONS_PER_WINDOW) return false; await c.env.DB.prepare('INSERT INTO submission_rate_limits (ip_hash,window_start,count) VALUES (?,?,1) ON CONFLICT(ip_hash) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN submission_rate_limits.window_start=excluded.window_start THEN submission_rate_limits.count+1 ELSE 1 END').bind(hash, windowStart).run(); return true; }
app.post('/api/events', async (c) => {
  if (!(await withinSubmissionLimit(c))) return c.json({ error:'投稿が多すぎます。少し待ってから再試行してください。' }, 429);
  const body = await c.req.json<{title?:string;startDate?:string;description?:string;website?:string}>().catch(() => ({} as { title?: string; startDate?: string; description?: string; website?: string }));
  if (body.website) return c.json({ error:'入力を確認してください。' }, 400);
  const title = (body.title ?? '').trim(); const startDate = body.startDate ?? ''; const description = (body.description ?? '').trim();
  if (title.length < 1 || title.length > 100 || description.length > 300 || !validDate(startDate)) return c.json({ error:'タイトルと過去の日付を正しく入力してください。' }, 400);
  const result = await c.env.DB.prepare('INSERT INTO events (title,start_date,description) VALUES (?,?,?)').bind(title,startDate,description).run();
  return c.json({ id: result.meta.last_row_id }, 201);
});

app.use('/api/admin/*', async (c, next) => basicAuth({ username: c.env.ADMIN_USER, password: c.env.ADMIN_PASSWORD })(c, next));
app.get('/api/admin/events', async (c) => { const rows = await c.env.DB.prepare('SELECT * FROM events ORDER BY created_at DESC').all<EventRow>(); return c.json(rows.results ?? []); });
app.patch('/api/admin/events/:id', async (c) => {
  const id = Number(c.req.param('id')); const body = await c.req.json<{title?:string;startDate?:string;description?:string;status?:string}>();
  if (!Number.isInteger(id) || !body.title?.trim() || !validDate(body.startDate ?? '') || !['published','hidden'].includes(body.status ?? '')) return c.json({error:'入力が不正です'},400);
  await c.env.DB.prepare('UPDATE events SET title=?,start_date=?,description=?,status=?,updated_at=datetime(\'now\') WHERE id=?').bind(body.title.trim(),body.startDate, (body.description ?? '').trim(),body.status,id).run(); return c.json({ok:true});
});
app.delete('/api/admin/events/:id', async (c) => { await c.env.DB.prepare('DELETE FROM events WHERE id=?').bind(Number(c.req.param('id'))).run(); return c.json({ok:true}); });

export default app;
