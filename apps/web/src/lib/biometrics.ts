import Human from '@vladmandic/human';

export type BiometricSample={
  imageDataUrl:string;embedding:number[];faceCount:number;faceQualityScore:number;livenessScore:number;antiSpoofScore:number;livenessChallengePassed:boolean;
};

export type BiometricEngineStatus='idle'|'loading'|'warming'|'ready'|'error';

type StatusListener=(status:BiometricEngineStatus)=>void;
let humanPromise:Promise<any>|null=null;
let engineStatus:BiometricEngineStatus='idle';
const listeners=new Set<StatusListener>();

function publish(status:BiometricEngineStatus){
  engineStatus=status;
  for(const listener of listeners) listener(status);
}

export function getBiometricEngineStatus(){return engineStatus;}
export function onBiometricEngineStatus(listener:StatusListener){listeners.add(listener);listener(engineStatus);return()=>{listeners.delete(listener);};}

function createHuman(){
  return new Human({
    backend:'webgl',
    // IMPORTANT: models are shipped with the app. Never depend on a remote model host.
    modelBasePath:'/models/human/',
    cacheModels:true,
    validateModels:false,
    async:true,
    cacheSensitivity:0.68,
    filter:{enabled:false,equalization:false,flip:false},
    face:{
      enabled:true,
      detector:{rotation:true,maxDetected:2,minConfidence:0.45,skipFrames:4,skipTime:180},
      mesh:{enabled:true,skipFrames:1,skipTime:80},
      iris:{enabled:false},
      description:{enabled:true,skipFrames:3,skipTime:220},
      antispoof:{enabled:true,skipFrames:2,skipTime:180},
      liveness:{enabled:true,skipFrames:2,skipTime:180},
      emotion:{enabled:false}
    },
    body:{enabled:false},hand:{enabled:false},object:{enabled:false},gesture:{enabled:true}
  } as any);
}

/** Loads the enabled model files and prepares WebGL. Camera/UI must never wait before opening. */
export function getHuman(){
  if(!humanPromise){
    humanPromise=(async()=>{
      try{
        publish('loading');
        const human:any=createHuman();
        await human.load();
        publish('warming');
        // Warmup happens during login/onboarding in the background. If a user opens the
        // camera unusually fast, only the AI validation waits; the live preview is already open.
        await human.warmup();
        publish('ready');
        return human;
      }catch(error){
        humanPromise=null;publish('error');throw error;
      }
    })();
  }
  return humanPromise;
}

/** Starts model download/cache as early as possible without blocking navigation. */
export function preloadHuman(){return getHuman();}

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
