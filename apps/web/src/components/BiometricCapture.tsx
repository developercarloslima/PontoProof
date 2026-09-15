import { useEffect,useRef,useState } from 'react';
import { BiometricSample,captureVideoFrame,challengeText } from '../lib/biometrics';

type Props={title?:string;challengeAction:string;onCapture:(sample:BiometricSample)=>void;onCancel:()=>void;compact?:boolean;minQuality?:number;minLiveness?:number;minAntiSpoof?:number};

export default function BiometricCapture({title='Confirmação facial',challengeAction,onCapture,onCancel,compact}:Props){
 const videoRef=useRef<HTMLVideoElement>(null);const streamRef=useRef<MediaStream|null>(null);const [ready,setReady]=useState(false);const [status,setStatus]=useState('Abrindo câmera…');const [error,setError]=useState('');
 useEffect(()=>{let mounted=true;(async()=>{try{
   const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640,max:960},height:{ideal:480,max:720},frameRate:{ideal:24,max:30}},audio:false});
   if(!mounted){stream.getTracks().forEach(t=>t.stop());return;}streamRef.current=stream;
   const video=videoRef.current!;video.srcObject=stream;await video.play();
   setStatus(challengeText(challengeAction));
   // Give autofocus/exposure a brief moment, but never wait for an AI model in the browser.
   window.setTimeout(()=>{if(mounted)setReady(true);},650);
 }catch(e){setError(e instanceof Error?e.message:'Não foi possível abrir a câmera');setStatus('Falha ao abrir a câmera');}})();
 return()=>{mounted=false;streamRef.current?.getTracks().forEach(t=>t.stop());};},[challengeAction]);
 function capture(){if(!ready||!videoRef.current)return;const imageDataUrl=captureVideoFrame(videoRef.current);setReady(false);setStatus('Imagem capturada — validando no servidor…');onCapture({imageDataUrl});streamRef.current?.getTracks().forEach(t=>t.stop());}
 return <div className={compact?'bio-capture compact':'bio-overlay'}><div className="bio-dialog"><div className="bio-head"><div><div className="eyebrow">IDENTIDADE BIOMÉTRICA</div><h2>{title}</h2></div><button className="ghost" type="button" onClick={onCancel}>Fechar</button></div>
   <div className="camera-stage"><video ref={videoRef} playsInline muted autoPlay/><div className={`face-ring ${ready?'ok':''}`}/><div className="camera-instruction">{status}</div></div>
   <div className="engine-state"><span className="engine-dot ready"/><span>Análise facial rápida no servidor</span></div>
   {error&&<div className="error-box">{error}<br/><small>Confira a permissão da câmera e tente novamente.</small></div>}
   <div className="bio-actions"><button className="primary" type="button" disabled={!ready} onClick={capture}>Capturar e confirmar</button><small>A câmera só captura a imagem. Face match, qualidade, liveness e antispoof são calculados pelo servidor.</small></div>
 </div></div>;
}
