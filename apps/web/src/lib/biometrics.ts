export type BiometricSample={
  imageDataUrl:string;
  embedding?:number[];
  faceCount?:number;
  faceQualityScore?:number;
  livenessScore?:number;
  antiSpoofScore?:number;
  livenessChallengePassed?:boolean;
};

/**
 * v0.4.7: the browser is capture-only. All facial AI runs on the API, where
 * models stay warm and do not need to be downloaded/compiled on every phone.
 */
export function challengeText(action:string){
  return ({TURN_LEFT:'Vire o rosto para a esquerda',TURN_RIGHT:'Vire o rosto para a direita',HEAD_UP:'Olhe para cima',HEAD_DOWN:'Olhe para baixo'} as Record<string,string>)[action]??'Olhe para a câmera';
}

export function captureVideoFrame(video:HTMLVideoElement){
  const sourceW=video.videoWidth||640,sourceH=video.videoHeight||480;
  const width=Math.min(640,sourceW);const height=Math.max(1,Math.round(sourceH*(width/sourceW)));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas indisponível');ctx.drawImage(video,0,0,width,height);
  return canvas.toDataURL('image/jpeg',0.80);
}
