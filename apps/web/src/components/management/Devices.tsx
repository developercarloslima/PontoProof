import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function Devices(){
  const [items,setItems]=useState<any[]>([]); const [msg,setMsg]=useState('');
  const load=()=>api<any[]>('/admin/devices').then(setItems);
  useEffect(()=>{load().catch(()=>{});},[]);
  async function trust(id:string,trusted:boolean){setMsg('');try{await api(`/admin/devices/${id}/trust`,{method:'POST',body:JSON.stringify({trusted})});setMsg(trusted?'Dispositivo autorizado.':'Confiança removida.');await load();}catch(e){setMsg(e instanceof Error?e.message:'Erro');}}
  return <section className="card"><div className="eyebrow">DISPOSITIVOS</div><h2>Confiança de dispositivo</h2><p className="muted">O fingerprint do navegador é apenas um sinal auxiliar. Autorizar um dispositivo aumenta o ProofScore, mas não substitui attestation nativa.</p>{msg&&<div className="success-box">{msg}</div>}<div className="table-wrap"><table><thead><tr><th>Colaborador</th><th>Dispositivo</th><th>Última atividade</th><th>Confiança</th><th/></tr></thead><tbody>{items.map(i=><tr key={i.id}><td><b>{i.employee?.name}</b><small>{i.employee?.employeeNumber}</small></td><td><b>{i.label||'Sem identificação'}</b><small>{i.fingerprint.slice(0,20)}…</small></td><td>{i.lastSeenAt?new Date(i.lastSeenAt).toLocaleString('pt-BR'):'—'}</td><td><span className={`status ${i.trusted?'approved':'pending'}`}>{i.trusted?'AUTORIZADO':'PENDENTE'}</span></td><td><button className="ghost" onClick={()=>trust(i.id,!i.trusted)}>{i.trusted?'Remover confiança':'Autorizar'}</button></td></tr>)}</tbody></table></div></section>;
}
