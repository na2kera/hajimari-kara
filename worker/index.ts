import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';

type Bindings = { DB: D1Database; ADMIN_USER: string; ADMIN_PASSWORD: string };
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

app.post('/api/events', async (c) => {
  const body = await c.req.json<{title?:string;startDate?:string;description?:string}>().catch(() => ({} as { title?: string; startDate?: string; description?: string }));
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
