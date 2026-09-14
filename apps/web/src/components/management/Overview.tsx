import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type OverviewData = { employees:number; working:number; onBreak:number; finished:number; withoutPunch:number; pendingAdjustments:number; lowProofCount:number; alerts:Array<{id:string;severity:string;title:string;description:string}> };

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const load = () => Promise.all([api<OverviewData>('/dashboard/overview'), api<any[]>('/adjustments')]).then(([d,r]) => { setData(d); setRequests(r); });
  useEffect(() => { load().catch(() => {}); }, []);

  async function review(id:string, approve:boolean) {
    setMessage('');
    try {
      await api(`/adjustments/${id}/${approve ? 'approve' : 'reject'}`, { method:'POST', body: JSON.stringify({ note: approve ? 'Aprovado pela central de gestão' : 'Rejeitado pela central de gestão' }) });
      setMessage(approve ? 'Ajuste aprovado e novo evento imutável criado.' : 'Solicitação rejeitada.');
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Falha ao revisar'); }
  }

  async function resolveAlert(id:string){ try { await api(`/alerts/${id}/resolve`,{method:'POST',body:'{}'}); await load(); } catch(e){ setMessage(e instanceof Error?e.message:'Falha ao resolver alerta'); } }

  const pending = requests.filter(r => r.status === 'PENDING');
  return <>
    <div className="metrics metrics-7">
      <div className="metric"><span>Colaboradores</span><strong>{data?.employees ?? '—'}</strong></div>
      <div className="metric"><span>Trabalhando</span><strong>{data?.working ?? '—'}</strong></div>
      <div className="metric"><span>Em intervalo</span><strong>{data?.onBreak ?? '—'}</strong></div>
      <div className="metric"><span>Finalizados</span><strong>{data?.finished ?? '—'}</strong></div>
      <div className="metric"><span>Sem marcação</span><strong>{data?.withoutPunch ?? '—'}</strong></div>
      <div className="metric"><span>Ajustes</span><strong>{data?.pendingAdjustments ?? '—'}</strong></div>
      <div className="metric"><span>Prova baixa</span><strong>{data?.lowProofCount ?? '—'}</strong></div>
    </div>
    <div className="grid-two">
      <section className="card">
        <div className="eyebrow">PRÉ-FECHAMENTO</div><h2>Pendências da jornada</h2>
        {message && <div className="success-box">{message}</div>}
        {pending.length === 0 ? <p className="muted">Nenhum ajuste pendente.</p> : pending.slice(0,8).map(r => <div className="approval-row" key={r.id}>
          <div><b>{r.employee?.name}</b><span>{new Date(r.requestedTime).toLocaleString('pt-BR')} · {r.requestedType}</span><small>{r.reason}</small></div>
          <div className="inline-actions"><button onClick={() => review(r.id,true)}>Aprovar</button><button className="ghost danger" onClick={() => review(r.id,false)}>Rejeitar</button></div>
        </div>)}
      </section>
      <section className="card">
        <div className="eyebrow">CENTRAL DE RISCO</div><h2>Alertas ativos</h2>
        {!data?.alerts?.length ? <p className="muted">Nenhum alerta ativo.</p> : data.alerts.map(a => <div className="alert-row" key={a.id}><span className={`severity ${a.severity.toLowerCase()}`}>{a.severity}</span><div><b>{a.title}</b><small>{a.description}</small><button className="ghost alert-action" onClick={()=>resolveAlert(a.id)}>Marcar como resolvido</button></div></div>)}
      </section>
    </div>
  </>;
}
