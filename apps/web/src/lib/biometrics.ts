import Human from '@vladmandic/human';

export type BiometricSample={
  imageDataUrl:string;embedding:number[];faceCount:number;faceQualityScore:number;livenessScore:number;antiSpoofScore:number;livenessChallengePassed:boolean;
};

let humanPromise:Promise<any>|null=null;
export function getHuman(){
  if(!humanPromise) humanPromise=(async()=>{
    const human:any=new Human({
      backend:'webgl',modelBasePath:'/models/human/',cacheSensitivity:0.7,
      filter:{enabled:true,equalization:false,flip:false},
      face:{enabled:true,detector:{rotation:true,maxDetected:2,minConfidence:0.45},mesh:{enabled:true},iris:{enabled:true},description:{enabled:true},antispoof:{enabled:true},liveness:{enabled:true},emotion:{enabled:false}},
      body:{enabled:false},hand:{enabled:false},object:{enabled:false},gesture:{enabled:true}
    } as any);
    await human.load();
    await human.warmup();
    return human;
  })();
  return humanPromise;
}

export function challengeText(action:string){
  return ({BLINK:'Piscar os olhos',TURN_LEFT:'Virar o rosto para a esquerda',TURN_RIGHT:'Virar o rosto para a direita',HEAD_UP:'Olhar para cima',HEAD_DOWN:'Olhar para baixo'} as Record<string,string>)[action]??'Piscar os olhos';
}

export function challengeSatisfied(action:string,gestures:string[],blinkCycle:boolean){
  if(action==='BLINK')return blinkCycle;
  if(action==='TURN_LEFT')return gestures.includes('facing left');
  if(action==='TURN_RIGHT')return gestures.includes('facing right');
  if(action==='HEAD_UP')return gestures.includes('head up');
  if(action==='HEAD_DOWN')return gestures.includes('head down');
  return false;
}

export function captureVideoFrame(video:HTMLVideoElement){
  const sourceW=video.videoWidth||640,sourceH=video.videoHeight||480;
  const width=Math.min(720,sourceW);const height=Math.max(1,Math.round(sourceH*(width/sourceW)));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas indisponível');ctx.drawImage(video,0,0,width,height);
  return canvas.toDataURL('image/jpeg',0.82);
}
