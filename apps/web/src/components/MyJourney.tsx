import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtMinutes } from '../lib/format';

type Punch = { id:string; recordNumber:string; type:string; occurredAt:string; source:string; offline:boolean; integrityHash:string; superseded?:boolean; proof?:{proofScore:number;proofLevel:string} };
const label:Record<string,string>={CLOCK_IN:'Entrada',BREAK_START:'Intervalo',BREAK_END:'Retorno',CLOCK_OUT:'Saída'};
export default function MyJourney(){
 const [items,setItems]=useState<Punch[]>([]); const [explain,setExplain]=useState<any>(null); const [summary,setSummary]=useState<any>(null); const [bank,setBank]=useState<any>(null);
 useEffect(()=>{Promise.all([api<Punch[]>('/punches/me'),api('/assistant/explain-my-day'),api('/time/me'),api('/bank/me')]).then(([p,e,s,b])=>{setItems(p);setExplain(e);setSummary(s);setBank(b)}).catch(()=>{});},[]);
 return <><div className="metrics"><div className="metric"><span>Trabalhado no mês</span><strong>{summary?fmtMinutes(summary.totals.workedMinutes):'—'}</strong></div><div className="metric"><span>Extras</span><strong>{summary?fmtMinutes(summary.totals.overtime50Minutes+summary.totals.overtime100Minutes):'—'}</strong></div><div className="metric"><span>Déficit</span><strong>{summary?fmtMinutes(summary.totals.missingMinutes):'—'}</strong></div><div className="metric"><span>Banco acumulado</span><strong>{bank?fmtMinutes(bank.balanceMinutes):'—'}</strong></div></div><div className="grid-two">
  <section className="card"><div className="eyebrow">MINHA JORNADA</div><h2>Marcações recentes</h2><div className="timeline">
   {items.length===0?<p className="muted">Nenhuma marcação registrada.</p>:items.map(p=><div className={`timeline-item ${p.superseded?'superseded':''}`} key={p.id}><div className="timeline-dot"/><div><b>{label[p.type]||p.type}{p.superseded?' · substituído':''}</b><span>{new Date(p.occurredAt).toLocaleString('pt-BR')}</span><small>{p.source}{p.offline?' · sincronizado offline':''} · NSR #{p.recordNumber}</small></div><div className="score-pill">{p.proof?.proofScore??0}</div></div>)}
  </div></section>
  <section className="card assistant-card"><div className="eyebrow">PONTO IA · EXPLICAÇÃO</div><h2>Entenda seu dia</h2><p>{explain?.explanation ?? 'Calculando sua jornada...'}</p>{explain?.warnings?.length>0&&<div className="warning-list">{explain.warnings.map((w:string,i:number)=><div key={i}>⚠ {w}</div>)}</div>}<div className="assistant-note">O motor usa as marcações efetivas e correções aprovadas, preserva os registros substituídos e apresenta banco, extras e divergências de forma explicável.</div></section>
 </div></>;
}
