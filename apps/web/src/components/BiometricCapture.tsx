import { useEffect,useRef,useState } from 'react';
import { BiometricSample,captureVideoFrame,challengeSatisfied,challengeText,getHuman } from '../lib/biometrics';

type Props={title?:string;challengeAction:string;onCapture:(sample:BiometricSample)=>void;onCancel:()=>void;compact?:boolean;minQuality?:number;minLiveness?:number;minAntiSpoof?:number};

export default function BiometricCapture({title='Confirmação facial',challengeAction,onCapture,onCancel,compact,minQuality=0.55,minLiveness=0.65,minAntiSpoof=0.65}:Props){
 const videoRef=useRef<HTMLVideoElement>(null);const streamRef=useRef<MediaStream|null>(null);const running=useRef(true);const blinkStarted=useRef(false);
 const [status,setStatus]=useState('Preparando reconhecimento facial…');const [metrics,setMetrics]=useState<any>({faceCount:0,quality:0,live:0,real:0,embedding:[],challenge:false});const [ready,setReady]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{running.current=true;(async()=>{try{
   const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false});streamRef.current=stream;
   const video=videoRef.current!;video.srcObject=stream;await video.play();const human=await getHuman();setStatus(`Faça a ação: ${challengeText(challengeAction)}`);
   while(running.current){
     const result:any=await human.detect(video);const faces=result.face??[];const face=faces[0];const gestures:string[]=(result.gesture??[]).map((g:any)=>g.gesture);
     const blinking=gestures.includes('blink left eye')||gestures.includes('blink right eye');if(blinking)blinkStarted.current=true;const blinkCycle=blinkStarted.current&&!blinking;
     const challenge=challengeSatisfied(challengeAction,gestures,blinkCycle);const box=face?.box??[0,0,0,0];const faceSize=Math.min(box[2]??0,box[3]??0);const sizeScore=Math.min(1,faceSize/220);
     const confidence=Number(face?.faceScore??face?.boxScore??0);const quality=Math.max(0,Math.min(1,confidence*0.7+sizeScore*0.3));const live=Number(face?.live??0);const real=Number(face?.real??0);const embedding=Array.isArray(face?.embedding)?face.embedding.map(Number):[];
     const next={faceCount:faces.length,quality,live,real,embedding,challenge,gestures};setMetrics(next);
     const ok=faces.length===1&&quality>=minQuality&&live>=minLiveness&&real>=minAntiSpoof&&embedding.length>=64&&challenge;setReady(ok);
     if(faces.length===0)setStatus('Posicione seu rosto dentro da câmera');else if(faces.length>1)setStatus('Somente uma pessoa pode aparecer na câmera');else if(quality<minQuality)setStatus('Aproxime o rosto e melhore a iluminação');else if(real<minAntiSpoof)setStatus('Antispoof ainda não validado — mantenha o rosto visível');else if(live<minLiveness)setStatus('Prova de vida em análise — movimente-se naturalmente');else if(!challenge)setStatus(`Agora: ${challengeText(challengeAction)}`);else setStatus('Identidade pronta para captura ✓');
     await new Promise(r=>setTimeout(r,220));
   }
 }catch(e){setError(e instanceof Error?e.message:'Não foi possível acessar a câmera');}})();return()=>{running.current=false;streamRef.current?.getTracks().forEach(t=>t.stop());};},[challengeAction,minQuality,minLiveness,minAntiSpoof]);
 function capture(){if(!ready||!videoRef.current)return;const imageDataUrl=captureVideoFrame(videoRef.current);onCapture({imageDataUrl,embedding:metrics.embedding,faceCount:metrics.faceCount,faceQualityScore:metrics.quality,livenessScore:metrics.live,antiSpoofScore:metrics.real,livenessChallengePassed:metrics.challenge});streamRef.current?.getTracks().forEach(t=>t.stop());running.current=false;}
 return <div className={compact?'bio-capture compact':'bio-overlay'}><div className="bio-dialog"><div className="bio-head"><div><div className="eyebrow">IDENTIDADE BIOMÉTRICA</div><h2>{title}</h2></div><button className="ghost" type="button" onClick={onCancel}>Fechar</button></div>
   <div className="camera-stage"><video ref={videoRef} playsInline muted/><div className={`face-ring ${ready?'ok':''}`}/><div className="camera-instruction">{status}</div></div>
   {error&&<div className="error-box">{error}</div>}<div className="metric-grid"><span>Rosto <b>{metrics.faceCount===1?'✓':'—'}</b></span><span>Qualidade <b>{Math.round(metrics.quality*100)}%</b></span><span>Liveness <b>{Math.round(metrics.live*100)}%</b></span><span>Antispoof <b>{Math.round(metrics.real*100)}%</b></span><span>Ação <b>{metrics.challenge?'✓':'—'}</b></span></div>
   <div className="bio-actions"><button className="primary" type="button" disabled={!ready} onClick={capture}>Capturar e confirmar</button><small>A validação final e o face match são feitos pelo servidor.</small></div>
 </div></div>;
}
