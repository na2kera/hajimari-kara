import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type EventItem = { id:number; title:string; start_date:string; description:string; status?:string; created_at?:string };
const today = () => new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Tokyo'}));
function elapsed(date:string) { const start = new Date(`${date}T00:00:00+09:00`); return Math.max(0, Math.floor((today().getTime()-start.getTime())/86400000)); }
function anniversary(date:string) { const s = new Date(`${date}T00:00:00+09:00`), now=today(); let years=now.getFullYear()-s.getFullYear(); const thisYear=new Date(`${now.getFullYear()}-${date.slice(5)}T00:00:00+09:00`); if(thisYear>now) years--; return Math.max(0,years); }

function App() {
  const [events,setEvents]=useState<EventItem[]>([]); const [title,setTitle]=useState(''); const [date,setDate]=useState(''); const [description,setDescription]=useState('');
  const [mode,setMode]=useState<'days'|'years'>('days'); const [view,setView]=useState<'list'|'chart'>('list'); const [sort,setSort]=useState('new'); const [loading,setLoading]=useState(true); const [message,setMessage]=useState('');
  const load=()=>fetch('/api/events').then(r=>r.json()).then(setEvents).finally(()=>setLoading(false)); useEffect(()=>{load()},[]);
  const sorted=useMemo(()=>[...events].sort((a,b)=>sort==='days' ? elapsed(b.start_date)-elapsed(a.start_date) : sort==='daysAsc' ? elapsed(a.start_date)-elapsed(b.start_date) : (b.created_at??'').localeCompare(a.created_at??'')),[events,sort]);
  async function submit(e:React.FormEvent){e.preventDefault();setMessage('');const r=await fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,startDate:date,description})});const d=await r.json();if(!r.ok){setMessage(d.error);return}setTitle('');setDate('');setDescription('');setMessage('登録しました');load()}
  return <main><header><div><p className="eyebrow">STARTED ON</p><h1>はじまりから、今日まで。</h1><p className="lead">作品、出来事、記念日。始まった日からの時間を眺める場所。</p></div><a className="admin" href="/admin">管理</a></header>
    <section className="card form-card"><h2>新しい出来事を登録</h2><form onSubmit={submit}><div className="fields"><label>名前<input value={title} maxLength={100} onChange={e=>setTitle(e.target.value)} placeholder="例：ポケットモンスター 赤・緑 発売" required/></label><label>始まった日<input type="date" value={date} max={new Date().toISOString().slice(0,10)} onChange={e=>setDate(e.target.value)} required/></label></div><label>補足（任意）<input value={description} maxLength={300} onChange={e=>setDescription(e.target.value)} placeholder="例：日本での発売日"/></label><button>登録する</button>{message&&<span className="message">{message}</span>}</form></section>
    <section className="toolbar"><div className="tabs"><button className={view==='list'?'active':''} onClick={()=>setView('list')}>一覧</button><button className={view==='chart'?'active':''} onClick={()=>setView('chart')}>棒グラフ</button></div><select value={sort} onChange={e=>setSort(e.target.value)}><option value="new">登録が新しい順</option><option value="days">経過日数が多い順</option><option value="daysAsc">経過日数が少ない順</option></select><div className="toggle"><button className={mode==='days'?'active':''} onClick={()=>setMode('days')}>経過日数</button><button className={mode==='years'?'active':''} onClick={()=>setMode('years')}>周年</button></div></section>
    {loading?<p className="empty">読み込み中…</p>:sorted.length===0?<p className="empty">まだ登録がありません。最初の出来事を登録してみましょう。</p>:view==='chart'?<Chart events={sorted} mode={mode}/>:<div className="list">{sorted.map(x=><article className="event card" key={x.id}><div><h3>{x.title}</h3>{x.description&&<p>{x.description}</p>}<small>{x.start_date.replaceAll('-','.')}</small></div><strong>{mode==='days'?`${elapsed(x.start_date).toLocaleString()}日`:`${anniversary(x.start_date)}周年`}</strong></article>)}</div>}
  </main>
}
function Chart({events,mode}:{events:EventItem[];mode:'days'|'years'}){const values=events.slice(0,10).map(x=>mode==='days'?elapsed(x.start_date):anniversary(x.start_date));const max=Math.max(...values,1);return <div className="chart card">{events.slice(0,10).map((x,i)=><div className="bar-row" key={x.id}><span>{x.title}</span><div className="bar-track"><div className="bar" style={{width:`${Math.max(2,values[i]/max*100)}%`}}></div></div><b>{values[i].toLocaleString()}{mode==='days'?'日':'周年'}</b></div>)}</div>}
createRoot(document.getElementById('root')!).render(<App/>);
