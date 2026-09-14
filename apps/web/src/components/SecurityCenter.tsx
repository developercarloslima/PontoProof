import { useEffect,useState } from 'react';
import { api } from '../lib/api';
import { enrollPlatformBiometric,supportsWebAuthn } from '../lib/webauthn';

export default function SecurityCenter(){
 const [data,setData]=useState<any>(null);const [msg,setMsg]=useState('');const [busy,setBusy]=useState(false);
 const load=()=>api<any>('/security/status').then(setData);useEffect(()=>{load().catch(e=>setMsg(e.message));},[]);
 async function enroll(){setBusy(true);setMsg('');try{await enrollPlatformBiometric('Biometria deste dispositivo');setMsg('Biometria/passkey cadastrada com sucesso.');await load();}catch(e){setMsg(e instanceof Error?e.message:'Falha no cadastro biométrico');}finally{setBusy(false);}}
 async function acknowledge(){setBusy(true);setMsg('');try{await api('/security/biometric-notice/acknowledge',{method:'POST',body:'{}'});setMsg('Ciência do aviso biométrico registrada e auditada.');await load();}catch(e){setMsg(e instanceof Error?e.message:'Falha ao registrar ciência');}finally{setBusy(false);}}
 async function revokeCredential(id:string){if(!confirm('Remover esta biometria/passkey do PontoProof?'))return;await api(`/security/webauthn/credentials/${id}`,{method:'DELETE'});setMsg('Credencial revogada.');await load();}
 return <div className="management-grid">
  <section className="card span-wide"><div className="eyebrow">AVISO DE TRATAMENTO BIOMÉTRICO</div><h2>Ciência obrigatória antes da primeira marcação</h2><p className="notice-copy">{data?.biometricNotice?.text??'Carregando aviso…'}</p><div className="fact-row"><span>Versão</span><b>{data?.biometricNotice?.version??'—'}</b></div><div className="fact-row"><span>Status</span><b>{data?.acknowledgement?'CIÊNCIA REGISTRADA':'PENDENTE'}</b></div>{!data?.acknowledgement&&<button className="primary" disabled={busy} onClick={acknowledge}>Li e reconheço este aviso</button>}<p className="muted">Este registro de ciência não substitui a definição da base legal e as demais obrigações de proteção de dados da organização.</p></section>
  <section className="card"><div className="eyebrow">MINHA SEGURANÇA</div><h2>Biometria do dispositivo</h2><p className="muted">No navegador, impressão digital, Windows Hello, Touch ID, Face ID ou outro autenticador da plataforma são usados via WebAuthn. O PontoProof recebe uma prova criptográfica; não recebe sua impressão digital bruta.</p>
   <div className="fact-row"><span>WebAuthn no navegador</span><b>{supportsWebAuthn()?'Disponível':'Indisponível'}</b></div><div className="fact-row"><span>Credenciais cadastradas</span><b>{data?.credentials?.length??0}</b></div><div className="fact-row"><span>Cadastro facial</span><b>{data?.employee?.faceEnrollmentStatus??'—'}</b></div>
   <button className="primary" disabled={busy||!supportsWebAuthn()} onClick={enroll}>{busy?'Aguardando dispositivo…':'Cadastrar biometria / passkey'}</button>
   <div className="credential-list">{data?.credentials?.map((c:any)=><div className="request-item" key={c.id}><div><b>{c.label||'Autenticador da plataforma'}</b><small>{new Date(c.createdAt).toLocaleString('pt-BR')}</small></div><button className="ghost" onClick={()=>revokeCredential(c.id)}>Revogar</button></div>)}</div>{msg&&<div className="success-box">{msg}</div>}
  </section>
  <section className="card"><div className="eyebrow">POLÍTICA ATUAL</div><h2>Provas exigidas</h2><ul className="reason-list">{data?.policy&&Object.entries(data.policy).filter(([k,v])=>k.startsWith('require')&&v===true).map(([k])=><li key={k}>✓ {k}</li>)}</ul><div className="native-limits"><b>Limites do modo web</b><p className="muted">Play Integrity/App Attest, root/jailbreak e identificação confiável de SSID não podem ser atestados com força nativa em um PWA. Eles aparecem como indisponíveis, nunca como “aprovados” simulados. No web usamos HTTPS/localhost, WebAuthn, face/liveness/antispoof, geolocalização e provas ambientais suportadas.</p></div></section>
 </div>;
}
