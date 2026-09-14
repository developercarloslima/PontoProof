import { useEffect,useRef,useState } from 'react';

type Props={onCapture:(images:string[])=>Promise<void>|void;onCancel:()=>void};

function capture(video:HTMLVideoElement){
  const canvas=document.createElement('canvas');
  const width=Math.max(480,Math.min(720,video.videoWidth||640));
  const ratio=(video.videoHeight||480)/(video.videoWidth||640);
  canvas.width=width;canvas.height=Math.round(width*ratio);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas indisponível');
  ctx.drawImage(video,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',0.86);
}

export default function FaceLoginCapture({onCapture,onCancel}:Props){
 const videoRef=useRef<HTMLVideoElement>(null);const streamRef=useRef<MediaStream|null>(null);const [ready,setReady]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{let mounted=true;(async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});if(!mounted){stream.getTracks().forEach(t=>t.stop());return;}streamRef.current=stream;if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play();setReady(true);}}catch(e){setError(e instanceof Error?e.message:'Não foi possível abrir a câmera');}})();return()=>{mounted=false;streamRef.current?.getTracks().forEach(t=>t.stop());};},[]);
 async function confirm(){if(!videoRef.current||!ready)return;setBusy(true);setError('');try{const first=capture(videoRef.current);await new Promise(r=>setTimeout(r,450));const second=capture(videoRef.current);await onCapture([first,second]);streamRef.current?.getTracks().forEach(t=>t.stop());}catch(e){setError(e instanceof Error?e.message:'Falha ao capturar o rosto');setBusy(false);}}
 return <div className="status-popup-backdrop"><div className="status-popup face-login-popup"><div className="eyebrow">LOGIN FACIAL</div><h2>Olhe para a câmera</h2><p className="muted">Capturaremos duas imagens rápidas. A comparação acontece no servidor e nenhuma IA precisa carregar no seu navegador.</p><div className="face-login-video-wrap"><video ref={videoRef} playsInline muted/></div>{error&&<div className="error-box">{error}</div>}<div className="inline-actions"><button className="primary" disabled={!ready||busy} onClick={confirm}>{busy?'Confirmando…':'Confirmar meu rosto'}</button><button className="ghost" disabled={busy} onClick={onCancel}>Cancelar</button></div></div></div>;
}
