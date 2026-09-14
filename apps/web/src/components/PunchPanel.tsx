import { useEffect,useState } from 'react';
import { api } from '../lib/api';
import { getDeviceFingerprint,getLocation } from '../lib/device';
import { performPlatformBiometric } from '../lib/webauthn';
import { collectBluetoothName,collectNetworkGatewayToken,collectNfcTag } from '../lib/presence';
import type { BiometricSample } from '../lib/biometrics';
import BiometricCapture from './BiometricCapture';
import ProofGauge from './ProofGauge';
import QrTokenInput from './QrTokenInput';

type Punch={id:string;recordNumber:string;type:string;occurredAt:string;integrityHash:string;decision:string;proof?:{proofScore:number;proofLevel:string;reasonsJson:string[];missingRequirementsJson?:string[]}};
const labels:Record<string,string>={CLOCK_IN:'Iniciar jornada',BREAK_START:'Iniciar intervalo',BREAK_END:'Retorno do intervalo',PAUSE_START:'Iniciar pausa',PAUSE_END:'Retorno da pausa',CLOCK_OUT:'Finalizar jornada'};

type PendingPunch={type:string;challenge:any;biometric:{biometricProofToken:string;credentialId:string}};

export default function PunchPanel(){
 const [punches,setPunches]=useState<Punch[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[now,setNow]=useState(new Date()),[security,setSecurity]=useState<any>(null),[pending,setPending]=useState<PendingPunch|null>(null),[qrToken,setQrToken]=useState('');const last=punches[0];
 async function load(){try{setPunches(await api<Punch[]>('/punches/me'));}catch{}}
 async function loadSecurity(){try{const x=await api<any>('/security/status');setSecurity(x);return x;}catch{return security;}}
 useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),1000);load();loadSecurity();api('/devices/register',{method:'POST',body:JSON.stringify({fingerprint:getDeviceFingerprint(),label:navigator.userAgent.slice(0,90)})}).catch(()=>{});return()=>window.clearInterval(timer);},[]);

 async function sendPunch(type:string,challenge:any,biometric:any,sample?:BiometricSample){
   setMessage(sample?'Validando biometria digital, face e presença…':'Validando biometria digital e presença enquanto sua face é analisada…');
   const location=await getLocation();let bluetoothName='',nfcTagId='',networkGatewayToken='';
   if(challenge.policy?.requireBluetoothBeacon)bluetoothName=await collectBluetoothName();
   if(challenge.policy?.requireNfcTag)nfcTagId=await collectNfcTag();
   if(challenge.policy?.requireNetworkAttestation)networkGatewayToken=await collectNetworkGatewayToken();
   const payload:any={type,clientEventId:crypto.randomUUID(),challengeId:challenge.id,occurredAt:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Maceio',offline:false,deviceFingerprint:getDeviceFingerprint(),...location,biometricProofToken:biometric.biometricProofToken,dynamicQrToken:qrToken||undefined,networkGatewayToken:networkGatewayToken||undefined,bluetoothName:bluetoothName||undefined,nfcTagId:nfcTagId||undefined,clientSecureContext:window.isSecureContext};
   if(sample)Object.assign(payload,{selfieDataUrl:sample.imageDataUrl,faceEmbedding:sample.embedding,faceCount:sample.faceCount,faceQualityScore:sample.faceQualityScore,livenessScore:sample.livenessScore,antiSpoofScore:sample.antiSpoofScore,livenessChallengePassed:sample.livenessChallengePassed});
   const result=await api<any>('/punches',{method:'POST',body:JSON.stringify(payload)});
   if(challenge.verificationMode==='DEVICE_ONLY_PENDING_FACE')setMessage(`Marcação provisória registrada com biometria digital. Seu cadastro facial ainda está sendo analisado. ProofScore ${result.proof?.proofScore??0}/100.`);
   else setMessage(`Marcação ${result.decision==='REVIEW'?'registrada e enviada para revisão':'aprovada'}. ProofScore ${result.proof?.proofScore??0}/100 (${result.proof?.proofLevel??''}).`);
   setQrToken('');await load();await loadSecurity();
 }

 async function begin(type:string){
   setMessage('');setBusy(true);
   try{
     if(!navigator.onLine)throw new Error('A marcação exige biometria digital/passkey e, por segurança, precisa de conexão com o servidor.');
     const fresh=await loadSecurity();
     if(!fresh)throw new Error('A política de segurança ainda não foi carregada.');
     if(!fresh.acknowledgement)throw new Error('Antes de bater o ponto, abra “Minha segurança” e reconheça o aviso de tratamento biométrico.');
     if(fresh?.policy?.requireDynamicQr&&!qrToken)throw new Error('Escaneie o QR dinâmico da unidade antes da marcação.');
     const challenge:any=await api('/punches/challenge',{method:'POST',body:JSON.stringify({type})});
     setMessage('Confirme sua biometria digital/passkey…');
     const biometric=await performPlatformBiometric(challenge.id);
     if(challenge.verificationMode==='DEVICE_ONLY_PENDING_FACE'){
       await sendPunch(type,challenge,biometric);
       setPending(null);
     }else{
       setPending({type,challenge,biometric});
     }
   }catch(e){setMessage(e instanceof Error?e.message:'Não foi possível iniciar a validação.');setPending(null);}
   finally{setBusy(false);}
 }

 async function finish(sample:BiometricSample){
   if(!pending)return;setBusy(true);
   try{await sendPunch(pending.type,pending.challenge,pending.biometric,sample);}
   catch(e){setMessage(e instanceof Error?`Não foi possível registrar: ${e.message}`:'Não foi possível registrar.');}
   finally{setPending(null);setBusy(false);}
 }

 const policy=pending?.challenge?.policy??security?.policy??{};
 const facePending=security?.employee?.faceEnrollmentStatus==='PENDING'&&['PENDING','PROCESSING'].includes(String(security?.faceEnrollmentSubmission?.status??''));
 return <div className="grid-two"><section className="card hero-card"><div className="eyebrow">REGISTRO COM PROVA DE IDENTIDADE</div><div className="clock">{now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div><p className="muted">{now.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'})}</p>
  {!security?.acknowledgement&&<div className="warning-box">Ciência biométrica pendente. Abra <b>Minha segurança</b> antes da primeira marcação.</div>}
  {facePending&&<div className="warning-box"><b>Cadastro facial em análise.</b> Temporariamente, cada marcação pede somente sua biometria digital/passkey. Assim que a face for aprovada, serão exigidas as duas provas.</div>}
  {security?.policy?.requireDynamicQr&&<QrTokenInput value={qrToken} onChange={setQrToken} required/>}<div className="punch-actions six-actions">{Object.entries(labels).map(([type,label])=><button key={type} disabled={busy||!security?.acknowledgement} onClick={()=>begin(type)}>{label}</button>)}</div><div className="security-note">{facePending?'Modo provisório: biometria digital obrigatória enquanto o servidor conclui o cadastro facial.':'Modo completo: toda marcação exige biometria digital/passkey e reconhecimento facial, além das provas de presença configuradas.'}</div>{message&&<div className="success-box">{message}</div>}
 </section><section className="card"><div className="card-head"><div><div className="eyebrow">ÚLTIMA PROVA</div><h3>{last?labels[last.type]:'Sem marcações'}</h3></div>{last?.proof&&<ProofGauge score={last.proof.proofScore} level={last.proof.proofLevel}/>}</div>{last?<><div className="fact-row"><span>Horário</span><b>{new Date(last.occurredAt).toLocaleString('pt-BR')}</b></div><div className="fact-row"><span>Status</span><b>{last.decision}</b></div><div className="fact-row"><span>NSR interno</span><b>#{last.recordNumber}</b></div><div className="hash-box"><span>Hash de integridade</span><code>{last.integrityHash}</code></div><ul className="reason-list">{last.proof?.reasonsJson?.slice(0,10).map((r,i)=><li key={i}>✓ {r}</li>)}</ul>{last.proof?.missingRequirementsJson?.length?<ul className="warning-list">{last.proof.missingRequirementsJson.map((r,i)=><li key={i}>⚠ {r}</li>)}</ul>:null}</>:<p className="muted">Sua primeira marcação aparecerá aqui com as provas verificáveis e hash de integridade.</p>}</section>
 {pending&&<BiometricCapture title={labels[pending.type]} challengeAction={pending.challenge.livenessAction} minQuality={Number(policy.minFaceQualityScore??0.55)} minLiveness={Number(policy.minLivenessScore??0.65)} minAntiSpoof={Number(policy.minAntiSpoofScore??0.65)} onCapture={finish} onCancel={()=>setPending(null)}/>}</div>;
}
