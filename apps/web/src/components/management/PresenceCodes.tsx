import { useEffect,useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../../lib/api';
export default function PresenceCodes(){
 const [worksites,setWorksites]=useState<any[]>([]),[selected,setSelected]=useState(''),[token,setToken]=useState(''),[qr,setQr]=useState(''),[expires,setExpires]=useState<Date|null>(null),[msg,setMsg]=useState('');
 useEffect(()=>{api<any[]>('/admin/worksites').then(x=>{setWorksites(x);if(x[0])setSelected(x[0].id)});},[]);
 async function refresh(){if(!selected)return;try{const x=await api<any>(`/security/worksites/${selected}/presence-code`);setToken(x.token);setQr(await QRCode.toDataURL(x.token,{width:320,margin:2}));setExpires(new Date(Date.now()+x.expiresInSeconds*1000));setMsg('');}catch(e){setMsg(e instanceof Error?e.message:'Erro');}}
 useEffect(()=>{refresh();const t=setInterval(refresh,70000);return()=>clearInterval(t);},[selected]);
 return <section className="card"><div className="eyebrow">PROVA AMBIENTAL</div><h2>QR dinâmico da unidade</h2><p className="muted">Exiba este QR em uma tela física dentro da unidade. O token expira rapidamente e é assinado pelo servidor.</p><label>Local<select value={selected} onChange={e=>setSelected(e.target.value)}>{worksites.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>{qr&&<div className="presence-qr"><img src={qr}/><small>Expira aproximadamente às {expires?.toLocaleTimeString('pt-BR')}</small></div>}<button className="ghost" onClick={refresh}>Gerar novo código</button>{msg&&<div className="error-box">{msg}</div>}<details><summary>Token para leitor sem câmera</summary><code className="token-box">{token}</code></details></section>;
}
