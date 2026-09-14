import { useEffect,useRef,useState } from 'react';
import { BiometricSample,captureVideoFrame,challengeSatisfied,challengeText,getBiometricEngineStatus,getHuman,onBiometricEngineStatus } from '../lib/biometrics';

type Props={title?:string;challengeAction:string;onCapture:(sample:BiometricSample)=>void;onCancel:()=>void;compact?:boolean;minQuality?:number;minLiveness?:number;minAntiSpoof?:number};

function engineLabel(status:string){
 if(status==='loading')return 'Validação facial iniciando em segundo plano';
 if(status==='warming')return 'Validação facial otimizada';
 if(status==='ready')return 'Validação facial ativa';
 if(status==='error')return 'Falha ao iniciar validação facial';
 return 'Validação facial iniciando';
}

export default function BiometricCapture({title='Confirmação facial',challengeAction,onCapture,onCancel,compact,minQuality=0.55,minLiveness=0.65,minAntiSpoof=0.65}:Props){
 const videoRef=useRef<HTMLVideoElement>(null);const streamRef=useRef<MediaStream|null>(null);const running=useRef(true);const blinkStarted=useRef(false);const analysisCanvas=useRef<HTMLCanvasElement|null>(null);
 const [engineStatus,setEngineStatus]=useState(getBiometricEngineStatus());
 const [status,setStatus]=useState('Abrindo câmera…');const [metrics,setMetrics]=useState<any>({faceCount:0,quality:0,live:0,real:0,embedding:[],challenge:false});const [ready,setReady]=useState(false);const [error,setError]=useState('');
 useEffect(()=>onBiometricEngineStatus(setEngineStatus),[]);
 useEffect(()=>{running.current=true;(async()=>{try{
   // Start both operations immediately, but NEVER wait for AI before showing the camera.
   const humanTask=getHuman();
   setStatus('Abrindo câmera…');
   const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640,max:960},height:{ideal:480,max:720},frameRate:{ideal:24,max:30}},audio:false});streamRef.current=stream;
   if(!running.current){stream.getTracks().forEach(t=>t.stop());return;}
   const video=videoRef.current!;video.srcObject=stream;await video.play();
   setStatus('Câmera pronta — olhando para você…');

   // Models may still be downloading on the first-ever visit, but the live preview is already visible.
   const human=await humanTask;
   if(!running.current)return;
   setStatus(`Faça a ação: ${challengeText(challengeAction)}`);

   if(!analysisCanvas.current){const c=document.createElement('canvas');c.width=320;c.height=240;analysisCanvas.current=c;}
   const canvas=analysisCanvas.current;const ctx=canvas.getContext('2d',{alpha:false});
   if(!ctx)throw new Error('Canvas de análise indisponível');

   while(running.current){
     // Analyze a smaller frame for fast inference while keeping the visible/captured image at normal quality.
     ctx.drawImage(video,0,0,canvas.width,canvas.height);
     const result:any=await human.detect(canvas);if(!running.current)break;const faces=result.face??[];const face=faces[0];const gestures:string[]=(result.gesture??[]).map((g:any)=>g.gesture);
     const blinking=gestures.includes('blink left eye')||gestures.includes('blink right eye');if(blinking)blinkStarted.current=true;const blinkCycle=blinkStarted.current&&!blinking;
     const challenge=challengeSatisfied(challengeAction,gestures,blinkCycle);const box=face?.box??[0,0,0,0];const faceSize=Math.min(box[2]??0,box[3]??0);const sizeScore=Math.min(1,faceSize/90);
     const confidence=Number(face?.faceScore??face?.boxScore??0);const quality=Math.max(0,Math.min(1,confidence*0.7+sizeScore*0.3));const live=Number(face?.live??0);const real=Number(face?.real??0);const embedding=Array.isArray(face?.embedding)?face.embedding.map(Number):[];
     const next={faceCount:faces.length,quality,live,real,embedding,challenge,gestures};setMetrics(next);
     const ok=faces.length===1&&quality>=minQuality&&live>=minLiveness&&real>=minAntiSpoof&&embedding.length>=64&&challenge;setReady(ok);
     if(faces.length===0)setStatus('Posicione seu rosto dentro da câmera');else if(faces.length>1)setStatus('Somente uma pessoa pode aparecer na câmera');else if(quality<minQuality)setStatus('Aproxime o rosto e melhore a iluminação');else if(real<minAntiSpoof)setStatus('Mantenha o rosto visível');else if(live<minLiveness)setStatus('Movimente-se naturalmente');else if(!challenge)setStatus(`Agora: ${challengeText(challengeAction)}`);else setStatus('Identidade pronta para captura ✓');
     await new Promise(r=>setTimeout(r,150));
   }
 }catch(e){setError(e instanceof Error?e.message:'Não foi possível abrir a câmera/validação facial');setStatus('Falha na validação facial');}})();return()=>{running.current=false;streamRef.current?.getTracks().forEach(t=>t.stop());};},[challengeAction,minQuality,minLiveness,minAntiSpoof]);
 function capture(){if(!ready||!videoRef.current)return;const imageDataUrl=captureVideoFrame(videoRef.current);onCapture({imageDataUrl,embedding:metrics.embedding,faceCount:metrics.faceCount,faceQualityScore:metrics.quality,livenessScore:metrics.live,antiSpoofScore:metrics.real,livenessChallengePassed:metrics.challenge});streamRef.current?.getTracks().forEach(t=>t.stop());running.current=false;}
 return <div className={compact?'bio-capture compact':'bio-overlay'}><div className="bio-dialog"><div className="bio-head"><div><div className="eyebrow">IDENTIDADE BIOMÉTRICA</div><h2>{title}</h2></div><button className="ghost" type="button" onClick={onCancel}>Fechar</button></div>
   <div className="camera-stage"><video ref={videoRef} playsInline muted autoPlay/><div className={`face-ring ${ready?'ok':''}`}/><div className="camera-instruction">{status}</div></div>
   <div className="engine-state"><span className={`engine-dot ${engineStatus}`}/><span>{engineLabel(engineStatus)}</span></div>
   {error&&<div className="error-box">{error}<br/><small>Confira a permissão da câmera e tente novamente.</small></div>}<div className="metric-grid"><span>Rosto <b>{metrics.faceCount===1?'✓':'—'}</b></span><span>Qualidade <b>{Math.round(metrics.quality*100)}%</b></span><span>Liveness <b>{Math.round(metrics.live*100)}%</b></span><span>Antispoof <b>{Math.round(metrics.real*100)}%</b></span><span>Ação <b>{metrics.challenge?'✓':'—'}</b></span></div>
   <div className="bio-actions"><button className="primary" type="button" disabled={!ready} onClick={capture}>Capturar e confirmar</button><small>A câmera abre imediatamente; a validação final e o face match continuam obrigatórios.</small></div>
 </div></div>;
}
