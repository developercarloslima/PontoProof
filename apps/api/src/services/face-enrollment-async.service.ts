import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import jpeg from 'jpeg-js';
import { FacePose, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { decryptDatabaseImage, encryptImageDataUrlForDatabase, encryptJson, readEncryptedImage, removeEncryptedEvidence } from './biometric-storage.service.js';
import { getOrCreateSecuritySettings } from './security-settings.service.js';

export type EnrollmentPhoto = { pose: FacePose; imageDataUrl: string };
type StoredPhoto = { pose: FacePose; encryptedData?: string; storageKey?: string; mime?: string; byteLength?: number };
type EngineMode = 'detect' | 'fast' | 'secure';
type ProcessedPhoto = StoredPhoto & {
  embedding:number[];
  quality:number;
  liveness:number | null;
  antiSpoof:number | null;
  faceCount:number;
  gestures:string[];
  yaw:number | null;
  pitch:number | null;
};

type HumanConstructor = new (config?: any) => any;

const require = createRequire(import.meta.url);
let humanCtor: HumanConstructor | null = null;
let detectHumanPromise: Promise<any> | null = null;
let fastHumanPromise: Promise<any> | null = null;
let secureHumanPromise: Promise<any> | null = null;
let workerBusy = false;
let prewarmStarted = false;

function clamp(v:number){ return Math.max(0,Math.min(1,v)); }
function cosine(a:number[],b:number[]){
  if(!a.length||a.length!==b.length)return 0;
  let dot=0,aa=0,bb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
  return aa&&bb?clamp(dot/(Math.sqrt(aa)*Math.sqrt(bb))):0;
}

function humanPackagePaths(){
  const defaultEntry=require.resolve('@vladmandic/human');
  const distDir=path.dirname(defaultEntry);
  const wasmEntry=path.join(distDir,'human.node-wasm.js');
  const modelsDir=path.resolve(distDir,'../models');
  if(!fs.existsSync(wasmEntry))throw new Error(`Motor facial Human/WASM não encontrado em ${wasmEntry}`);
  if(!fs.existsSync(modelsDir))throw new Error(`Modelos faciais Human não encontrados em ${modelsDir}`);
  return {defaultEntry,distDir,wasmEntry,modelsDir};
}

function humanModelsUrl(){
  const {modelsDir}=humanPackagePaths();
  return pathToFileURL(modelsDir).href.replace(/\/$/,'')+'/';
}

function wasmFilesPath(){
  try {
    const entry=require.resolve('@tensorflow/tfjs-backend-wasm');
    return path.dirname(entry)+path.sep;
  } catch {
    return path.resolve(process.cwd(),'node_modules/@tensorflow/tfjs-backend-wasm/dist')+path.sep;
  }
}

function getHumanConstructor():HumanConstructor{
  if(humanCtor)return humanCtor;
  const {wasmEntry}=humanPackagePaths();
  const mod:any=require(wasmEntry);
  const ctor=mod?.default??mod?.Human;
  if(typeof ctor!=='function')throw new Error('Motor facial Human/WASM não pôde ser inicializado');
  humanCtor=ctor as HumanConstructor;
  return humanCtor;
}

function engineConfig(mode:EngineMode){
  const secure=mode==='secure';
  const descriptor=mode!=='detect';
  return {
    backend:'wasm',
    wasmPath:wasmFilesPath(),
    wasmPlatformFetch:false,
    modelBasePath:humanModelsUrl(),
    cacheModels:true,
    validateModels:false,
    async:true,
    warmup:'face',
    debug:false,
    filter:{enabled:false,equalization:false,flip:false},
    face:{
      enabled:true,
      detector:{rotation:false,maxDetected:2,minConfidence:0.48,skipFrames:0,skipTime:0},
      mesh:{enabled:secure},
      iris:{enabled:false},
      description:{enabled:descriptor,skipFrames:0,skipTime:0},
      antispoof:{enabled:secure,skipFrames:0,skipTime:0},
      liveness:{enabled:secure,skipFrames:0,skipTime:0},
      emotion:{enabled:false}
    },
    body:{enabled:false},hand:{enabled:false},object:{enabled:false},gesture:{enabled:secure}
  } as any;
}

async function buildHuman(mode:EngineMode){
  const Human=getHumanConstructor();
  const human:any=new Human(engineConfig(mode));
  await human.load();
  // Keep the shared promise unresolved until kernels are compiled. If a request
  // arrives during warmup it reuses the same promise instead of competing with it.
  if(typeof human.warmup==='function')await human.warmup();
  return human;
}

async function getServerHuman(mode:EngineMode){
  const current=mode==='detect'?detectHumanPromise:mode==='fast'?fastHumanPromise:secureHumanPromise;
  if(current)return current;
  const created=buildHuman(mode).catch(err=>{
    if(mode==='detect')detectHumanPromise=null;else if(mode==='fast')fastHumanPromise=null;else secureHumanPromise=null;
    throw err;
  });
  if(mode==='detect')detectHumanPromise=created;else if(mode==='fast')fastHumanPromise=created;else secureHumanPromise=created;
  return created;
}

/**
 * Preloads and compiles the face engines after Fastify starts listening.
 * FAST is warmed first because enrollment and reference matching use only
 * detector + descriptor. SECURE is warmed afterwards for liveness/antispoof.
 */
export async function prewarmFaceEngines(){
  if(prewarmStarted)return;
  prewarmStarted=true;
  try{
    await getServerHuman('detect');
    await getServerHuman('fast');
  }catch(error){
    console.warn('[PontoProof] prewarm enrollment face engines failed',error);
  }
  // Do not let the heavier liveness/antispoof warmup compete with an enrollment
  // submitted immediately after the service wakes up on a small Render instance.
  setTimeout(()=>{
    void (async()=>{
      try{
        await getServerHuman('secure');
      }catch(error){
        console.warn('[PontoProof] prewarm secure face engine failed',error);
      }
    })();
  },2500).unref();
}

function decodeStoredPhoto(photo:StoredPhoto){
  const raw=photo.encryptedData
    ? decryptDatabaseImage(photo.encryptedData)
    : photo.storageKey
      ? readEncryptedImage(photo.storageKey)
      : null;
  return raw;
}

function rgbTensorForDecoded(decoded:any,human:any,maxDimension:number){
  const srcW=Number(decoded.width),srcH=Number(decoded.height);
  const scale=Math.min(1,maxDimension/Math.max(srcW,srcH));
  const width=Math.max(1,Math.round(srcW*scale));
  const height=Math.max(1,Math.round(srcH*scale));
  const rgb=new Uint8Array(width*height*3);
  if(scale===1){
    for(let s=0,d=0;s<decoded.data.length;s+=4){rgb[d++]=decoded.data[s];rgb[d++]=decoded.data[s+1];rgb[d++]=decoded.data[s+2];}
  }else{
    let d=0;
    for(let y=0;y<height;y++){
      const sy=Math.min(srcH-1,Math.floor(y/scale));
      for(let x=0;x<width;x++){
        const sx=Math.min(srcW-1,Math.floor(x/scale));
        const s=(sy*srcW+sx)*4;
        rgb[d++]=decoded.data[s];rgb[d++]=decoded.data[s+1];rgb[d++]=decoded.data[s+2];
      }
    }
  }
  return {tensor:human.tf.tensor3d(rgb,[height,width,3],'int32'),width,height};
}

async function detectDecoded(photo:StoredPhoto,decoded:any,human:any,mode:EngineMode):Promise<ProcessedPhoto>{
  // 288px keeps enough facial detail for the descriptor while cutting WASM work
  // substantially versus decoding the original 720px selfie.
  const input=rgbTensorForDecoded(decoded,human,mode==='detect'?224:mode==='fast'?288:320);
  try{
    const result:any=await human.detect(input.tensor);
    const faces=result?.face??[];
    if(faces.length!==1)return {...photo,embedding:[],quality:0,liveness:null,antiSpoof:null,faceCount:faces.length,gestures:[],yaw:null,pitch:null};
    const face=faces[0];
    const box=face?.box??[0,0,0,0];
    const minDim=Math.max(1,Math.min(input.width,input.height));
    const relativeSize=Math.min(Number(box[2]??0),Number(box[3]??0))/minDim;
    const confidence=Math.max(Number(face?.faceScore??0),Number(face?.boxScore??0),Number(face?.score??0));
    const quality=clamp(confidence*0.72+clamp(relativeSize/0.42)*0.28);
    const rawEmbedding=face?.embedding;
    const embedding=Array.isArray(rawEmbedding)||ArrayBuffer.isView(rawEmbedding)?Array.from(rawEmbedding as ArrayLike<number>,Number):[];
    const gestures:string[]=(result?.gesture??[]).map((g:any)=>String(g?.gesture??'')).filter(Boolean);
    const yaw=Number.isFinite(Number(face?.rotation?.angle?.yaw))?Number(face.rotation.angle.yaw):null;
    const pitch=Number.isFinite(Number(face?.rotation?.angle?.pitch))?Number(face.rotation.angle.pitch):null;
    return {
      ...photo,
      embedding,
      quality,
      liveness:mode==='secure'?Number(face?.live??0):null,
      antiSpoof:mode==='secure'?Number(face?.real??0):null,
      faceCount:faces.length,
      gestures,yaw,pitch
    };
  } finally { human.tf.dispose(input.tensor); }
}

async function analyzePhoto(photo:StoredPhoto,mode:EngineMode='fast'):Promise<ProcessedPhoto>{
  const maybeRaw=decodeStoredPhoto(photo);
  const raw=maybeRaw instanceof Promise?await maybeRaw:maybeRaw;
  if(!raw)throw new Error('Evidência biométrica temporária ausente');
  const decoded=jpeg.decode(raw,{useTArray:true,formatAsRGBA:true});
  if(!decoded?.width||!decoded?.height||!decoded?.data)throw new Error('Imagem JPEG inválida');
  const human:any=await getServerHuman(mode);
  return detectDecoded(photo,decoded,human,mode);
}

export async function analyzeFaceReferenceDataUrl(imageDataUrl:string){
  const saved=encryptImageDataUrlForDatabase(imageDataUrl);
  const processed=await analyzePhoto({pose:FacePose.FRONT,encryptedData:saved.encryptedData,mime:saved.mime,byteLength:saved.byteLength},'fast');
  return {
    embedding:processed.embedding,
    quality:processed.quality,
    liveness:processed.liveness,
    antiSpoof:processed.antiSpoof,
    faceCount:processed.faceCount,
    gestures:processed.gestures,
    yaw:processed.yaw,
    pitch:processed.pitch
  };
}

export async function analyzeFaceLoginDataUrl(imageDataUrl:string){
  const saved=encryptImageDataUrlForDatabase(imageDataUrl);
  const processed=await analyzePhoto({pose:FacePose.FRONT,encryptedData:saved.encryptedData,mime:saved.mime,byteLength:saved.byteLength},'secure');
  return {
    embedding:processed.embedding,
    quality:processed.quality,
    liveness:processed.liveness??0,
    antiSpoof:processed.antiSpoof??0,
    faceCount:processed.faceCount,
    gestures:processed.gestures,
    yaw:processed.yaw,
    pitch:processed.pitch
  };
}

export async function createAsyncFaceEnrollment(input:{tenantId:string;employeeId:string;userId:string;photos:EnrollmentPhoto[]}){
  const required=[FacePose.FRONT,FacePose.LEFT,FacePose.RIGHT];
  if(input.photos.length!==required.length)throw new Error('Envie exatamente 3 fotos: frontal, esquerda e direita');
  for(const pose of required){if(input.photos.filter(p=>p.pose===pose).length!==1)throw new Error(`Foto ${pose} ausente ou duplicada`);}
  const existing=await prisma.faceEnrollmentSubmission.findFirst({where:{tenantId:input.tenantId,employeeId:input.employeeId,status:{in:['PENDING','PROCESSING']}},orderBy:{submittedAt:'desc'}});
  if(existing)return existing;
  const stored:StoredPhoto[]=[];
  try{
    for(const photo of input.photos){
      const saved=encryptImageDataUrlForDatabase(photo.imageDataUrl);
      stored.push({pose:photo.pose,encryptedData:saved.encryptedData,mime:saved.mime,byteLength:saved.byteLength});
    }
    return await prisma.$transaction(async tx=>{
      await tx.employee.update({where:{id:input.employeeId},data:{faceEnrollmentStatus:'PENDING',faceEnrolledAt:null}});
      const submission=await tx.faceEnrollmentSubmission.create({data:{tenantId:input.tenantId,employeeId:input.employeeId,userId:input.userId,status:'PENDING',imagesJson:stored as any,progress:5}});
      await tx.auditEvent.create({data:{tenantId:input.tenantId,actorUserId:input.userId,action:'FACE_ENROLLMENT_SUBMITTED',entityType:'FaceEnrollmentSubmission',entityId:submission.id,metadataJson:{poses:required,processing:'FAST_REFERENCE_WASM',targetMs:8000,deepLivenessAtPunch:true}}});
      return submission;
    });
  }catch(err){
    await Promise.all(stored.map(x=>x.storageKey?removeEncryptedEvidence(x.storageKey):Promise.resolve()));
    throw err;
  }
}

function publicSubmission(row:any){
  const processingMs=row?.processingStartedAt&&row?.processedAt?Math.max(0,new Date(row.processedAt).getTime()-new Date(row.processingStartedAt).getTime()):null;
  return {id:row.id,status:row.status,progress:row.progress,reasons:row.reasonsJson??null,submittedAt:row.submittedAt,processingStartedAt:row.processingStartedAt,processedAt:row.processedAt,processingMs};
}
export { publicSubmission };

function usesLegacyTmpEvidence(row:any){
  const images=Array.isArray(row?.imagesJson)?row.imagesJson as StoredPhoto[]:[];
  return images.some(photo=>Boolean(photo?.storageKey)&&!photo?.encryptedData);
}

async function markNeedsRetake(submission:any, reasons:any[], auditAction='FACE_ENROLLMENT_NEEDS_RETAKE'){
  const images=(submission.imagesJson??[]) as StoredPhoto[];
  await Promise.all(images.map(x=>x.storageKey?removeEncryptedEvidence(x.storageKey):Promise.resolve()));
  const [updated]=await prisma.$transaction([
    prisma.faceEnrollmentSubmission.update({where:{id:submission.id},data:{status:'NEEDS_RETAKE',progress:100,reasonsJson:reasons as any,imagesJson:[] as any,processedAt:new Date(),processingStartedAt:null}}),
    prisma.employee.update({where:{id:submission.employeeId},data:{faceEnrollmentStatus:'NOT_ENROLLED',faceEnrolledAt:null}}),
    prisma.auditEvent.create({data:{tenantId:submission.tenantId,actorUserId:submission.userId,action:auditAction,entityType:'FaceEnrollmentSubmission',entityId:submission.id,metadataJson:{reasons,scope:'FACE_ONLY',passwordPreserved:true,biometricNoticePreserved:true,webauthnPreserved:true}}})
  ]);
  return updated;
}

export async function recoverLegacyTmpFaceEnrollmentForUser(userId:string){
  const user=await prisma.user.findUnique({where:{id:userId},select:{tenantId:true,employee:{select:{id:true}}}});
  if(!user?.employee?.id)return null;
  const row=await prisma.faceEnrollmentSubmission.findFirst({
    where:{tenantId:user.tenantId,employeeId:user.employee.id,userId,status:{in:['PENDING','PROCESSING','FAILED']}},
    orderBy:{submittedAt:'desc'}
  });
  if(!row || !usesLegacyTmpEvidence(row))return row;
  return markNeedsRetake(row,[{
    pose:'ALL',
    code:'LEGACY_TMP_RECAPTURE',
    message:'As fotos anteriores pertenciam ao armazenamento temporário da versão anterior e não podem mais ser recuperadas. Refazer somente as 3 fotos faciais; sua senha, ciência biométrica e digital/passkey já cadastradas serão preservadas.'
  }],'FACE_ENROLLMENT_LEGACY_TMP_RECOVERY');
}

async function approveSubmission(submission:any, photos:ProcessedPhoto[],processingMs:number){
  await prisma.$transaction(async tx=>{
    await tx.faceReference.updateMany({where:{tenantId:submission.tenantId,employeeId:submission.employeeId,revokedAt:null},data:{revokedAt:new Date()}});
    for(const p of photos){
      if(p.embedding.length<64)continue;
      await tx.faceReference.create({data:{tenantId:submission.tenantId,employeeId:submission.employeeId,pose:p.pose,storageKey:null,embeddingEncrypted:encryptJson(p.embedding),faceQualityScore:p.quality,livenessScore:null,antiSpoofScore:null,createdByUserId:submission.userId}});
    }
    await tx.employee.update({where:{id:submission.employeeId},data:{faceEnrollmentStatus:'ACTIVE',faceEnrolledAt:new Date(),faceTemplateVersion:{increment:1},failedBiometricAttempts:0,biometricLockedUntil:null}});
    await tx.faceEnrollmentSubmission.update({where:{id:submission.id},data:{status:'APPROVED',progress:100,reasonsJson:{message:'As três imagens foram validadas rapidamente; a assinatura facial frontal foi ativada. Liveness e antispoof continuam obrigatórios nas marcações faciais.',processingMs,targetMs:8000} as any,imagesJson:[] as any,processedAt:new Date()}});
    await tx.auditEvent.create({data:{tenantId:submission.tenantId,actorUserId:submission.userId,action:'FACE_ENROLLMENT_APPROVED_ASYNC',entityType:'FaceEnrollmentSubmission',entityId:submission.id,metadataJson:{engine:'HUMAN_WASM_FRONT_REFERENCE_PLUS_SIDE_DETECT',processingMs,targetMs:8000,deepLivenessAtPunch:true,quality:photos.map(p=>({pose:p.pose,quality:p.quality}))}}});
  });
}

async function processSubmission(submission:any){
  const processingStartedAt=new Date();
  const claimed=await prisma.faceEnrollmentSubmission.updateMany({where:{id:submission.id,status:'PENDING'},data:{status:'PROCESSING',progress:15,processingStartedAt,processingAttempts:{increment:1}}});
  if(!claimed.count)return;
  const row=await prisma.faceEnrollmentSubmission.findUniqueOrThrow({where:{id:submission.id}});
  const policy=await getOrCreateSecuritySettings(row.tenantId);
  const stored=(row.imagesJson??[]) as StoredPhoto[];
  try{
    const front=stored.find(p=>p.pose===FacePose.FRONT);
    const left=stored.find(p=>p.pose===FacePose.LEFT);
    const right=stored.find(p=>p.pose===FacePose.RIGHT);
    if(!front||!left||!right)throw new Error('Conjunto de fotos do cadastro facial incompleto');
    // Only the frontal frame needs the descriptor model. The side frames are
    // quality/presence checks. This removes two expensive descriptor inferences.
    const processed:ProcessedPhoto[]=[];
    processed.push(await analyzePhoto(front,'fast'));
    await prisma.faceEnrollmentSubmission.update({where:{id:row.id},data:{progress:55}});
    processed.push(await analyzePhoto(left,'detect'));
    processed.push(await analyzePhoto(right,'detect'));
    await prisma.faceEnrollmentSubmission.update({where:{id:row.id},data:{progress:82}});
    const reasons:any[]=[];
    for(const p of processed){
      if(p.faceCount===0)reasons.push({pose:p.pose,code:'FACE_NOT_FOUND',message:'Nenhum rosto foi detectado'});
      else if(p.faceCount>1)reasons.push({pose:p.pose,code:'MULTIPLE_FACES',message:'Mais de um rosto apareceu na foto'});
      else if(p.quality<policy.minFaceQualityScore)reasons.push({pose:p.pose,code:'QUALITY',message:'Foto com pouca qualidade, distância inadequada ou iluminação insuficiente'});
      if(p.pose===FacePose.FRONT&&p.embedding.length<64)reasons.push({pose:p.pose,code:'EMBEDDING',message:'Não foi possível extrair a assinatura facial frontal'});
    }
    if(reasons.length)return markNeedsRetake(row,reasons);
    const processingMs=Date.now()-processingStartedAt.getTime();
    return approveSubmission(row,processed,processingMs);
  }catch(error:any){
    const message=error instanceof Error?error.message:'Falha desconhecida no processamento facial';
    if(error?.code==='ENOENT' || /Evidência biométrica temporária ausente|no such file or directory/i.test(message)){
      return markNeedsRetake(row,[{pose:'ALL',code:'EVIDENCE_EXPIRED',message:'As fotos anteriores não estão mais disponíveis. Faça uma nova captura; as próximas imagens ficarão persistidas com segurança até a análise terminar.'}]);
    }
    await prisma.faceEnrollmentSubmission.update({where:{id:row.id},data:{status:'FAILED',progress:100,reasonsJson:{code:'PROCESSING_ERROR',message} as any,processedAt:new Date()}});
    await prisma.auditEvent.create({data:{tenantId:row.tenantId,actorUserId:row.userId,action:'FACE_ENROLLMENT_PROCESSING_FAILED',entityType:'FaceEnrollmentSubmission',entityId:row.id,metadataJson:{engine:'HUMAN_WASM_FRONT_REFERENCE_PLUS_SIDE_DETECT',message,processingMs:Date.now()-processingStartedAt.getTime()}}});
  }
}

export async function runFaceEnrollmentWorkerOnce(){
  if(workerBusy)return {busy:true};
  workerBusy=true;
  try{
    await prisma.faceEnrollmentSubmission.updateMany({where:{status:'PROCESSING',processingStartedAt:{lt:new Date(Date.now()-3*60_000)}},data:{status:'PENDING',progress:5,processingStartedAt:null}});
    const next=await prisma.faceEnrollmentSubmission.findFirst({where:{status:'PENDING'},orderBy:{submittedAt:'asc'}});
    if(!next)return {processed:false};
    await processSubmission(next);
    return {processed:true,id:next.id};
  }finally{workerBusy=false;}
}

/** Fire-and-forget worker kick so a freshly submitted enrollment does not wait for the polling timer. */
export function kickFaceEnrollmentWorker(){
  setImmediate(()=>{void runFaceEnrollmentWorkerOnce().catch(error=>console.error('[PontoProof] immediate face worker failed',error));});
}

export async function retryFaceEnrollmentSubmission(input:{tenantId:string;userId:string;submissionId:string}){
  const row=await prisma.faceEnrollmentSubmission.findFirst({where:{id:input.submissionId,tenantId:input.tenantId,userId:input.userId}});
  if(!row)throw new Error('Solicitação facial não encontrada');
  if(usesLegacyTmpEvidence(row)){
    return markNeedsRetake(row,[{
      pose:'ALL',code:'LEGACY_TMP_RECAPTURE',
      message:'As fotos anteriores expiraram durante a atualização do armazenamento. Tire novamente somente as 3 fotos faciais; as demais etapas já concluídas serão mantidas.'
    }],'FACE_ENROLLMENT_LEGACY_TMP_RECOVERY');
  }
  if(row.status!=='FAILED')throw new Error('Somente uma análise com erro técnico pode ser reenviada sem novas fotos');
  const updated=await prisma.faceEnrollmentSubmission.update({where:{id:row.id},data:{status:'PENDING',progress:5,reasonsJson:Prisma.DbNull,processedAt:null,processingStartedAt:null}});
  kickFaceEnrollmentWorker();
  return updated;
}
