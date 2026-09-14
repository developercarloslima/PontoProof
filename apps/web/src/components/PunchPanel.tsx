import { useEffect,useState } from 'react';
import { api } from '../lib/api';
import { getDeviceFingerprint,getLocation } from '../lib/device';
import { enqueuePunch,getQueue,queueCount,removeQueued } from '../lib/offlineQueue';
import { performPlatformBiometric } from '../lib/webauthn';
import { collectBluetoothName,collectNetworkGatewayToken,collectNfcTag } from '../lib/presence';
import type { BiometricSample } from '../lib/biometrics';
import BiometricCapture from './BiometricCapture';
import ProofGauge from './ProofGauge';
import QrTokenInput from './QrTokenInput';

async function sha256Text(value:string){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');}
type Punch={id:string;recordNumber:string;type:string;occurredAt:string;integrityHash:string;decision:string;proof?:{proofScore:number;proofLevel:string;reasonsJson:string[];missingRequirementsJson?:string[]}};
const labels:Record<string,string>={CLOCK_IN:'Iniciar jornada',BREAK_START:'Iniciar intervalo',BREAK_END:'Retorno do intervalo',PAUSE_START:'Iniciar pausa',PAUSE_END:'Retorno da pausa',CLOCK_OUT:'Finalizar jornada'};
const actionList=['BLINK','TURN_LEFT','TURN_RIGHT','HEAD_UP','HEAD_DOWN'];

export default function PunchPanel(){
 const [punches,setPunches]=useState<Punch[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[queued,setQueued]=useState(0),[now,setNow]=useState(new Date()),[security,setSecurity]=useState<any>(null),[pending,setPending]=useState<any>(null),[qrToken,setQrToken]=useState('');const last=punches[0];
 async function refreshQueue(){setQueued(await queueCount().catch(()=>0));}
 async function load(){try{setPunches(await api<Punch[]>('/punches/me'));}catch{}}
 async function loadSecurity(){try{setSecurity(await api<any>('/security/status'));}catch{}}
 useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),1000);load();refreshQueue();loadSecurity();api('/devices/register',{method:'POST',body:JSON.stringify({fingerprint:getDeviceFingerprint(),label:navigator.userAgent.slice(0,90)})}).catch(()=>{});return()=>window.clearInterval(timer);},[]);
 useEffect(()=>{const sync=async()=>{for(const item of await getQueue()){try{await api('/punches',{method:'POST',body:JSON.stringify({...item.payload,offline:true,challengeId:undefined,biometricProofToken:undefined})});await removeQueued(item.id);}catch(e){const msg=e instanceof Error?e.message:'';if(msg.includes('bloqueada')||msg.includes('falhou')||msg.includes('não permite')||msg.includes('Ciência')){await removeQueued(item.id);continue;}break;}}await refreshQueue();await load();};window.addEventListener('online',sync);if(navigator.onLine)sync();return()=>window.removeEventListener('online',sync);},[]);
 async function begin(type:string){
   setMessage('');
   if(!security){setMessage('A política de segurança ainda não foi carregada.');return;}
   if(!security.acknowledgement){setMessage('Antes de bater o ponto, abra “Minha segurança” e reconheça o aviso de tratamento biométrico.');return;}
   if(security?.policy?.requireDynamicQr&&!qrToken){setMessage('Escaneie o QR dinâmico da unidade antes da marcação.');return;}
   try{let challenge:any;if(navigator.onLine)challenge=await api('/punches/challenge',{method:'POST',body:JSON.stringify({type})});else{if(!security.policy.allowOffline)throw new Error('Marcação offline não permitida pela empresa.');challenge={id:undefined,type,livenessAction:actionList[Math.floor(Math.random()*actionList.length)],policy:security.policy,offline:true};}setPending({type,challenge});}catch(e){setMessage(e instanceof Error?e.message:'Não foi possível iniciar a validação.');}
 }
 async function finish(sample:BiometricSample){
   if(!pending)return;setBusy(true);setMessage('Validando identidade e presença…');const {type,challenge}=pending;let payload:any=null;
   try{
     let biometric:any={};if(challenge.policy?.requirePlatformBiometric){if(!navigator.onLine)biometric={};else biometric=await performPlatformBiometric(challenge.id);}
     const location=await getLocation();let bluetoothName='',nfcTagId='',networkGatewayToken='';
     if(navigator.onLine&&challenge.policy?.requireBluetoothBeacon)bluetoothName=await collectBluetoothName();
     if(navigator.onLine&&challenge.policy?.requireNfcTag)nfcTagId=await collectNfcTag();
     if(navigator.onLine&&challenge.policy?.requireNetworkAttestation)networkGatewayToken=await collectNetworkGatewayToken();
     payload={type,clientEventId:crypto.randomUUID(),challengeId:challenge.id,occurredAt:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Maceio',offline:!navigator.onLine,deviceFingerprint:getDeviceFingerprint(),...location,selfieDataUrl:sample.imageDataUrl,faceEmbedding:sample.embedding,faceCount:sample.faceCount,faceQualityScore:sample.faceQualityScore,livenessScore:sample.livenessScore,antiSpoofScore:sample.antiSpoofScore,livenessChallengePassed:sample.livenessChallengePassed,biometricProofToken:biometric.biometricProofToken,dynamicQrToken:qrToken||undefined,networkGatewayToken:networkGatewayToken||undefined,bluetoothName:bluetoothName||undefined,nfcTagId:nfcTagId||undefined,clientSecureContext:window.isSecureContext};
     if(!navigator.onLine){payload.offlinePayloadHash=await sha256Text(JSON.stringify({...payload,selfieDataUrl:'[encrypted-local]'}));await enqueuePunch(payload);await refreshQueue();setMessage('Sem conexão: selfie e dados foram guardados criptografados. A sincronização será obrigatoriamente revisada e não receberá integridade máxima.');}
     else {const result=await api<any>('/punches',{method:'POST',body:JSON.stringify(payload)});setMessage(`Marcação ${result.decision==='REVIEW'?'registrada e enviada para revisão':'aprovada'}. ProofScore ${result.proof?.proofScore??0}/100 (${result.proof?.proofLevel??''}).`);setQrToken('');await load();}
   }catch(e){
     const connectionLost=!navigator.onLine||e instanceof TypeError;
     if(connectionLost&&payload&&security?.policy?.allowOffline){payload.offline=true;payload.challengeId=undefined;payload.biometricProofToken=undefined;payload.offlinePayloadHash=await sha256Text(JSON.stringify({...payload,selfieDataUrl:'[encrypted-local]'}));await enqueuePunch(payload).catch(()=>{});await refreshQueue();setMessage('A conexão caiu. A marcação foi preservada de forma criptografada e será enviada para revisão quando a internet voltar.');}
     else setMessage(e instanceof Error?`Não foi possível registrar: ${e.message}`:'Não foi possível registrar.');
   }finally{setPending(null);setBusy(false);}
 }
 const policy=pending?.challenge?.policy??security?.policy??{};
 return <div className="grid-two"><section className="card hero-card"><div className="eyebrow">REGISTRO COM PROVA DE IDENTIDADE</div><div className="clock">{now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div><p className="muted">{now.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'})}</p>
  {!security?.acknowledgement&&<div className="warning-box">Ciência biométrica pendente. Abra <b>Minha segurança</b> antes da primeira marcação.</div>}
  {security?.policy?.requireDynamicQr&&<QrTokenInput value={qrToken} onChange={setQrToken} required/>}<div className="punch-actions six-actions">{Object.entries(labels).map(([type,label])=><button key={type} disabled={busy||!security?.acknowledgement} onClick={()=>begin(type)}>{label}</button>)}</div><div className="security-note">Toda marcação exige selfie ao vivo. O servidor valida face, liveness, antispoof, presença, dispositivo e as demais provas configuradas. Offline nunca recebe integridade máxima automática.</div>{message&&<div className="success-box">{message}</div>}{queued>0&&<div className="queue-chip">{queued} marcação(ões) criptografada(s) aguardando sincronização</div>}
 </section><section className="card"><div className="card-head"><div><div className="eyebrow">ÚLTIMA PROVA</div><h3>{last?labels[last.type]:'Sem marcações'}</h3></div>{last?.proof&&<ProofGauge score={last.proof.proofScore} level={last.proof.proofLevel}/>}</div>{last?<><div className="fact-row"><span>Horário</span><b>{new Date(last.occurredAt).toLocaleString('pt-BR')}</b></div><div className="fact-row"><span>Status</span><b>{last.decision}</b></div><div className="fact-row"><span>NSR interno</span><b>#{last.recordNumber}</b></div><div className="hash-box"><span>Hash de integridade</span><code>{last.integrityHash}</code></div><ul className="reason-list">{last.proof?.reasonsJson?.slice(0,10).map((r,i)=><li key={i}>✓ {r}</li>)}</ul>{last.proof?.missingRequirementsJson?.length?<ul className="warning-list">{last.proof.missingRequirementsJson.map((r,i)=><li key={i}>⚠ {r}</li>)}</ul>:null}</>:<p className="muted">Sua primeira marcação aparecerá aqui com prova facial e hash verificável.</p>}</section>
 {pending&&<BiometricCapture title={labels[pending.type]} challengeAction={pending.challenge.livenessAction} minQuality={Number(policy.minFaceQualityScore??0.55)} minLiveness={Number(policy.minLivenessScore??0.65)} minAntiSpoof={Number(policy.minAntiSpoofScore??0.65)} onCapture={finish} onCancel={()=>setPending(null)}/>}</div>;
}
