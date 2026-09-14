import { useEffect,useState } from 'react';
import { api } from '../../lib/api';
import BiometricCapture from '../BiometricCapture';
import type { BiometricSample } from '../../lib/biometrics';

type Props={employee:{id:string;name:string};onClose:()=>void;onChanged?:()=>void};
const actionByPose:any={FRONT:'BLINK',LEFT:'TURN_LEFT',RIGHT:'TURN_RIGHT'};
export default function FaceEnrollmentManager({employee,onClose,onChanged}:Props){
 const [data,setData]=useState<any>(null);const [security,setSecurity]=useState<any>(null);const [pose,setPose]=useState<string>('');const [msg,setMsg]=useState('');
 const load=()=>Promise.all([api<any>(`/admin/employees/${employee.id}/face-references`),api<any>('/admin/security-settings')]).then(([refs,sec])=>{setData(refs);setSecurity(sec);});useEffect(()=>{load().catch(e=>setMsg(e.message));},[employee.id]);
 async function save(sample:BiometricSample){try{await api(`/admin/employees/${employee.id}/face-references`,{method:'POST',body:JSON.stringify({pose,...sample})});setPose('');setMsg('Referência facial atualizada e auditada.');await load();onChanged?.();}catch(e){setMsg(e instanceof Error?e.message:'Erro ao cadastrar face');}}
 async function reset(){if(!confirm('Revogar todas as referências faciais deste colaborador?'))return;await api(`/admin/employees/${employee.id}/face-reset`,{method:'POST',body:'{}'});setMsg('Cadastro facial revogado.');await load();onChanged?.();}
 return <div className="bio-overlay"><div className="bio-dialog enrollment-dialog"><div className="bio-head"><div><div className="eyebrow">CADASTRO FACIAL</div><h2>{employee.name}</h2></div><button className="ghost" onClick={onClose}>Fechar</button></div>
  <p className="muted">Cadastre pelo menos a foto frontal. Frontal + esquerda + direita aumentam a robustez. Cada substituição revoga a referência antiga sem apagar a trilha de auditoria.</p>
  <div className="face-ref-grid">{['FRONT','LEFT','RIGHT'].map(p=><div className="face-ref-card" key={p}><b>{p==='FRONT'?'Frontal':p==='LEFT'?'Lado esquerdo':'Lado direito'}</b><span>{data?.references?.find((r:any)=>r.pose===p)?'✓ Cadastrada':'Pendente'}</span><button className="ghost" onClick={()=>setPose(p)}>{data?.references?.find((r:any)=>r.pose===p)?'Recapturar':'Capturar'}</button></div>)}</div>
  <div className="fact-row"><span>Status</span><b>{data?.employee?.faceEnrollmentStatus??'—'}</b></div><div className="inline-actions"><button className="danger ghost" onClick={reset}>Revogar biometria facial</button></div>{msg&&<div className="success-box">{msg}</div>}
  {pose&&<BiometricCapture title={`Referência ${pose.toLowerCase()}`} challengeAction={actionByPose[pose]} minQuality={Number(security?.minFaceQualityScore??0.55)} minLiveness={Number(security?.minLivenessScore??0.65)} minAntiSpoof={Number(security?.minAntiSpoofScore??0.65)} onCapture={save} onCancel={()=>setPose('')}/>} 
 </div></div>;
}
