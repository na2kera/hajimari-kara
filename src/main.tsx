import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type EventItem = {
  id: number;
  title: string;
  start_date: string;
  description: string;
  status?: 'published' | 'hidden';
  created_at?: string;
};
type EventPage = { events: EventItem[]; total: number; page: number; pageSize: number };
type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

const japanToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
function utcDay(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}
function elapsed(date: string) {
  return Math.max(0, Math.floor((utcDay(japanToday()) - utcDay(date)) / 86400000));
}
function observedDay(year: number, month: number, day: number) {
  return Math.min(day, new Date(Date.UTC(year, month, 0)).getUTCDate());
}
function anniversary(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [nowYear, nowMonth, nowDay] = japanToday().split('-').map(Number);
  let years = nowYear - year;
  if (nowMonth < month || (nowMonth === month && nowDay < observedDay(nowYear, month, day))) years--;
  return Math.max(0, years);
}
function anniversaryLabel(date: string) {
  const years = anniversary(date);
  if (years > 0) return `${years}周年`;
  const [year, month, day] = date.split('-').map(Number);
  const targetYear = year + 1;
  const target = `${targetYear}-${String(month).padStart(2, '0')}-${String(observedDay(targetYear, month, day)).padStart(2, '0')}`;
  const days = Math.max(0, Math.floor((utcDay(target) - utcDay(japanToday())) / 86400000));
  return `1周年まであと${days}日`;
}
async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? `通信に失敗しました（${response.status}）`;
}

function TurnstileWidget({ siteKey, onToken, onError }: {
  siteKey: string; onToken: (token: string) => void; onError: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    let widgetId: string | undefined;
    const render = () => {
      if (!active || !container.current || !window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': onError,
      });
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (!script) {
      script = document.createElement('script');
      script.dataset.turnstile = 'true';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', render);
    script.addEventListener('error', onError);
    render();
    return () => {
      active = false;
      script?.removeEventListener('load', render);
      script?.removeEventListener('error', onError);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken, onError]);
  return <div className="turnstile" ref={container} />;
}

function App() {
  if (location.pathname.startsWith('/admin')) return <Admin />;
  return <PublicApp />;
}

function PublicApp() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [token, setToken] = useState('');
  const [siteKey, setSiteKey] = useState('');
  const [widgetEpoch, setWidgetEpoch] = useState(0);
  const [mode, setMode] = useState<'days' | 'years'>('days');
  const [view, setView] = useState<'list' | 'chart'>('list');
  const [sort, setSort] = useState('new');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [today, setToday] = useState(japanToday());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [listError, setListError] = useState('');
  const [widgetError, setWidgetError] = useState(false);
  const handleWidgetError = useCallback(() => { setToken(''); setWidgetError(true); }, []);

  useEffect(() => {
    const timer = setInterval(() => setToday(japanToday()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    fetch('/api/config').then(async response => {
      if (!response.ok) throw new Error(await responseError(response));
      return response.json() as Promise<{ turnstileSiteKey: string }>;
    }).then(config => setSiteKey(config.turnstileSiteKey))
      .catch(() => setWidgetError(true));
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError('');
    fetch(`/api/events?sort=${encodeURIComponent(sort)}&page=${page}`)
      .then(async response => {
        if (!response.ok) throw new Error(await responseError(response));
        return response.json() as Promise<EventPage>;
      })
      .then(data => { if (active) { setEvents(data.events); setTotal(data.total); } })
      .catch(error => { if (active) setListError(String(error.message ?? error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sort, page, reload]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) { setMessage('認証が完了してから登録してください。'); return; }
    setSubmitting(true);
    setMessage('');
    try {
      const response = await fetch('/api/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, startDate: date, description, website, turnstileToken: token }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setTitle(''); setDate(''); setDescription(''); setWebsite('');
      setMessage('登録しました');
      setPage(1);
      setReload(value => value + 1);
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setSubmitting(false);
      setToken('');
      setWidgetEpoch(value => value + 1);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / 20));
  const switchSort = (value: string) => { setSort(value); setPage(1); };
  return <main>
    <header><div><p className="eyebrow">STARTED ON</p><h1>はじまりから、今日まで。</h1>
      <p className="lead">作品、出来事、記念日。始まった日からの時間を眺める場所。</p></div>
      <a className="admin" href="/admin">管理</a></header>
    <section className="card form-card"><h2>新しい出来事を登録</h2>
      <form onSubmit={submit}>
        <div className="fields">
          <label>名前<input value={title} maxLength={100} onChange={event => setTitle(event.target.value)}
            placeholder="例：ポケットモンスター 赤・緑 発売" required /></label>
          <label>始まった日<input type="date" value={date} max={today}
            onChange={event => setDate(event.target.value)} required /></label>
        </div>
        <input className="trap" value={website} onChange={event => setWebsite(event.target.value)}
          tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <label>補足（任意）<input value={description} maxLength={300}
          onChange={event => setDescription(event.target.value)} placeholder="例：日本での発売日" /></label>
        {siteKey && <TurnstileWidget key={widgetEpoch} siteKey={siteKey}
          onToken={setToken} onError={handleWidgetError} />}
        {widgetError && <p className="form-error">認証を読み込めませんでした。ページを再読み込みしてください。</p>}
        <div className="form-actions"><button disabled={submitting || !token}>{submitting ? '登録中…' : '登録する'}</button>
          {message && <span role="status" className="message">{message}</span>}</div>
      </form>
    </section>
    <section className="toolbar">
      <div className="tabs"><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>一覧</button>
        <button className={view === 'chart' ? 'active' : ''} onClick={() => setView('chart')}>棒グラフ</button></div>
      <select value={sort} aria-label="並び替え" onChange={event => switchSort(event.target.value)}>
        <option value="new">登録が新しい順</option><option value="days">経過日数が多い順</option>
        <option value="daysAsc">経過日数が少ない順</option></select>
      <div className="toggle"><button className={mode === 'days' ? 'active' : ''} onClick={() => setMode('days')}>経過日数</button>
        <button className={mode === 'years' ? 'active' : ''} onClick={() => setMode('years')}>周年</button></div>
    </section>
    {loading ? <p className="empty">読み込み中…</p> : listError
      ? <p className="empty" role="alert">{listError}</p> : events.length === 0
      ? <p className="empty">{page > 1 ? 'このページには投稿がありません。' : 'まだ登録がありません。最初の出来事を登録してみましょう。'}</p>
      : view === 'chart' ? <Chart events={events} mode={mode} today={today} />
      : <div className="list">{events.map(item => <article className="event card" key={item.id}>
          <div><h3>{item.title}</h3>{item.description && <p>{item.description}</p>}
            <small>{item.start_date.replaceAll('-', '.')}</small></div>
          <strong>{mode === 'days' ? `${elapsed(item.start_date).toLocaleString()}日`
            : anniversaryLabel(item.start_date)}</strong>
        </article>)}</div>}
    {!loading && !listError && total > 20 && <nav className="pagination" aria-label="一覧のページ">
      <button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>前へ</button>
      <span>{page} / {pageCount} ページ</span>
      <button disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}>次へ</button>
    </nav>}
  </main>;
}

function Admin() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = async () => {
    try {
      const response = await fetch('/api/admin/events');
      if (!response.ok) throw new Error(await responseError(response));
      setEvents(await response.json() as EventItem[]);
      setError('');
    } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  async function update(item: EventItem, status = item.status ?? 'published') {
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/admin/events/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: item.title, startDate: item.start_date,
          description: item.description, status }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setEditing(null);
      await load();
    } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { setSaving(false); }
  }
  async function remove(id: number) {
    if (!confirm('この投稿を削除しますか？')) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/admin/events/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await responseError(response));
      await load();
    } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); }
    finally { setSaving(false); }
  }
  return <main>
    <header><div><p className="eyebrow">ADMIN</p><h1>投稿を管理</h1>
      <p className="lead">内容の修正と公開状態の変更ができます。</p></div>
      <a className="admin" href="/">公開画面へ</a></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p className="empty">読み込み中…</p> : <>
      {editing && <section className="card form-card">
        <h2>投稿を編集</h2>
        <form onSubmit={event => { event.preventDefault(); void update(editing); }}>
          <div className="fields">
            <label>名前<input value={editing.title} maxLength={100} required
              onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
            <label>始まった日<input type="date" value={editing.start_date} max={japanToday()} required
              onChange={event => setEditing({ ...editing, start_date: event.target.value })} /></label>
          </div>
          <label>補足<input value={editing.description} maxLength={300}
            onChange={event => setEditing({ ...editing, description: event.target.value })} /></label>
          <div className="form-actions"><button disabled={saving}>保存</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>キャンセル</button></div>
        </form>
      </section>}
      <div className="list">{events.map(item => <article className="event card" key={item.id}>
        <div><h3>{item.title}</h3><small>{item.start_date} · {item.status === 'hidden' ? '非表示' : '公開中'}</small></div>
        <div className="admin-actions">
          <button disabled={saving} onClick={() => setEditing({ ...item })}>編集</button>
          <button disabled={saving} onClick={() => void update(item, item.status === 'hidden' ? 'published' : 'hidden')}>
            {item.status === 'hidden' ? '公開' : '非表示'}</button>
          <button disabled={saving} className="danger" onClick={() => void remove(item.id)}>削除</button>
        </div>
      </article>)}</div>
    </>}
  </main>;
}

function Chart({ events, mode, today }: { events: EventItem[]; mode: 'days' | 'years'; today: string }) {
  void today;
  const shown = events.slice(0, 10);
  const values = shown.map(item => mode === 'days' ? elapsed(item.start_date) : anniversary(item.start_date));
  const max = Math.max(...values, 1);
  return <div className="chart card">{shown.map((item, index) => <div className="bar-row" key={item.id}>
    <span title={item.title}>{item.title}</span>
    <div className="bar-track"><div className="bar" style={{ width: `${Math.max(2, values[index] / max * 100)}%` }} /></div>
    <b>{values[index].toLocaleString()}{mode === 'days' ? '日' : '周年'}</b>
  </div>)}</div>;
}

createRoot(document.getElementById('root')!).render(<App />);
