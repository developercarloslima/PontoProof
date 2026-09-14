import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { fmtMinutes, fmtMoney, monthRange } from '../../lib/format';

function rangeFromMonth(month:string){
 const [year,m]=month.split('-').map(Number); const last=new Date(year,m,0).getDate();
 return {from:`${year}-${String(m).padStart(2,'0')}-01`,to:`${year}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`,label:month};
}
export default function Payroll(){
 const defaultRange=monthRange(); const [month,setMonth]=useState(defaultRange.label); const range=useMemo(()=>rangeFromMonth(month),[month]);
 const [periods,setPeriods]=useState<any[]>([]);const [current,setCurrent]=useState<any>(null);const [msg,setMsg]=useState('');const [busy,setBusy]=useState(false);
 const load=()=>api<any[]>('/payroll/periods').then(setPeriods);useEffect(()=>{load().catch(()=>{});},[]);
 async function generate(){setBusy(true);setMsg('');try{const r=await api<any>('/payroll/generate',{method:'POST',body:JSON.stringify({label:range.label,from:range.from,to:range.to})});setMsg(`Prévia gerada para ${r.count} colaborador(es).`);await load();await open(r.period.id);}catch(e){setMsg(e instanceof Error?e.message:'Erro');}finally{setBusy(false)}}
 async function open(id:string){setCurrent(await api(`/payroll/periods/${id}`));}
 return <><section className="card"><div className="card-head"><div><div className="eyebrow">JORNADA ESPELHO</div><h2>Prévia de folha</h2><p className="muted">Estimativa operacional antes da folha oficial. Não substitui cálculo trabalhista/contábil homologado.</p></div><div className="payroll-actions"><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/><button className="primary" onClick={generate} disabled={busy}>{busy?'Gerando...':'Gerar prévia'}</button></div></div>{msg&&<div className="success-box">{msg}</div>}<div className="period-list">{periods.map(p=><button key={p.id} onClick={()=>open(p.id)} className={current?.id===p.id?'active':''}><b>{p.label}</b><span>{p.status} · {p._count?.previews??0} pessoas</span></button>)}</div></section>{current&&<section className="card"><div className="eyebrow">DETALHAMENTO</div><h2>{current.label}</h2><div className="table-wrap"><table><thead><tr><th>Colaborador</th><th>Trabalhado</th><th>Extra 50%</th><th>Extra 100%</th><th>Noturno</th><th>Banco</th><th>Estimativa bruta</th><th>Alertas</th></tr></thead><tbody>{current.previews.map((p:any)=><tr key={p.id}><td><b>{p.employee.name}</b><small>{fmtMoney(p.employee.salaryCents)}</small></td><td>{fmtMinutes(p.workedMinutes)}</td><td>{fmtMinutes(p.overtime50Minutes)}<small>{fmtMoney(p.overtime50Cents)}</small></td><td>{fmtMinutes(p.overtime100Minutes)}<small>{fmtMoney(p.overtime100Cents)}</small></td><td>{fmtMinutes(p.nightMinutes)}<small>{fmtMoney(p.nightAdditionalCents)}</small></td><td>{fmtMinutes(p.bankDeltaMinutes)}</td><td><b>{fmtMoney(p.estimatedGrossCents)}</b></td><td>{Array.isArray(p.warningsJson)?p.warningsJson.length:0}</td></tr>)}</tbody></table></div></section>}</>;
}
