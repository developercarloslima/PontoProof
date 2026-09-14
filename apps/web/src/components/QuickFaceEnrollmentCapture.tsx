import { useEffect,useRef,useState } from 'react';

type Pose='FRONT'|'LEFT'|'RIGHT';
export type QuickEnrollmentPhoto={pose:Pose;imageDataUrl:string};
type Props={onSubmit:(photos:QuickEnrollmentPhoto[])=>Promise<void>|void;onCancel:()=>void};

const steps:{pose:Pose;title:string;instruction:string}[]=[
  {pose:'FRONT',title:'Foto frontal',instruction:'Olhe diretamente para a câmera, sem óculos escuros ou objetos cobrindo o rosto.'},
  {pose:'LEFT',title:'Lado esquerdo',instruction:'Vire levemente o rosto para a sua esquerda.'},
  {pose:'RIGHT',title:'Lado direito',instruction:'Vire levemente o rosto para a sua direita.'}
];

function captureFrame(video:HTMLVideoElement){
  const sw=video.videoWidth||640,sh=video.videoHeight||480;
  const width=Math.min(720,sw);const height=Math.max(1,Math.round(sh*(width/sw)));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas indisponível');
  ctx.drawImage(video,0,0,width,height);
  return canvas.toDataURL('image/jpeg',0.82);
}

export default function QuickFaceEnrollmentCapture({onSubmit,onCancel}:Props){
  const videoRef=useRef<HTMLVideoElement>(null);const streamRef=useRef<MediaStream|null>(null);
  const [photos,setPhotos]=useState<QuickEnrollmentPhoto[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [cameraReady,setCameraReady]=useState(false);
  const step=steps[Math.min(photos.length,steps.length-1)];
  useEffect(()=>{let mounted=true;(async()=>{try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640,max:1280},height:{ideal:480,max:720},frameRate:{ideal:24,max:30}},audio:false});
    if(!mounted){stream.getTracks().forEach(t=>t.stop());return;}streamRef.current=stream;
    const video=videoRef.current;if(!video)return;video.srcObject=stream;await video.play();if(mounted)setCameraReady(true);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível abrir a câmera');}})();return()=>{mounted=false;streamRef.current?.getTracks().forEach(t=>t.stop());};},[]);
  function take(){if(!cameraReady||!videoRef.current||photos.length>=3)return;try{const imageDataUrl=captureFrame(videoRef.current);setPhotos(prev=>[...prev,{pose:steps[prev.length].pose,imageDataUrl}]);}catch(e){setError(e instanceof Error?e.message:'Falha ao capturar foto');}}
  async function submit(){if(photos.length!==3)return;setBusy(true);setError('');try{await onSubmit(photos);streamRef.current?.getTracks().forEach(t=>t.stop());}catch(e){setError(e instanceof Error?e.message:'Falha ao enviar fotos');setBusy(false);}}
  function reset(){setPhotos([]);setError('');}
  return <div className="bio-overlay"><div className="bio-dialog enrollment-dialog"><div className="bio-head"><div><div className="eyebrow">CADASTRO FACIAL RÁPIDO</div><h2>Capture 3 fotos. A análise acontece depois.</h2></div><button className="ghost" onClick={onCancel} disabled={busy}>Fechar</button></div>
    <p className="muted">A câmera não carrega nenhum modelo de IA. Tire as fotos agora; o servidor valida qualidade, prova de vida passiva, antispoof e assinatura facial em segundo plano.</p>
    <div className="quick-face-grid"><div className="camera-stage quick-camera"><video ref={videoRef} playsInline muted autoPlay/><div className="face-ring"/><div className="camera-instruction">{photos.length<3?`${step.title}: ${step.instruction}`:'Fotos prontas para envio ✓'}</div></div>
      <div className="quick-face-side"><div className="quick-progress">{steps.map((s,i)=><div key={s.pose} className={photos[i]?'done':i===photos.length?'current':''}><b>{photos[i]?'✓':i+1}</b><span>{s.title}</span></div>)}</div>
        <div className="quick-thumbs">{photos.map((p,i)=><div key={p.pose}><img src={p.imageDataUrl}/><small>{steps[i].title}</small></div>)}</div>
        {photos.length<3?<button className="primary" disabled={!cameraReady||busy} onClick={take}>{cameraReady?`Capturar ${step.title.toLowerCase()}`:'Abrindo câmera…'}</button>:<><button className="primary success-button" disabled={busy} onClick={submit}>{busy?'Enviando…':'Enviar fotos para análise'}</button><button className="ghost" disabled={busy} onClick={reset}>Refazer as 3 fotos</button></>}
        <small className="muted">Depois do envio você pode seguir para a leitura digital/passkey. O reconhecimento facial não bloqueia esta tela.</small>{error&&<div className="error-box">{error}</div>}</div>
    </div>
  </div></div>;
}
