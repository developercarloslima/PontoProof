import { useEffect, useRef, useState } from 'react';
import Login from './components/Login';
import PunchPanel from './components/PunchPanel';
import MyJourney from './components/MyJourney';
import Adjustments from './components/Adjustments';
import Management from './components/Management';
import Audit from './components/Audit';
import SecurityCenter from './components/SecurityCenter';
import FirstAccessOnboarding from './components/FirstAccessOnboarding';
import { api, cacheUser, clearToken, getCachedUser, getToken, SessionUser } from './lib/api';

export default function App(){
 const [user,setUser]=useState<SessionUser|null>(getToken()?getCachedUser():null);
 const [tab,setTab]=useState('ponto');
 const [onboardingChecked,setOnboardingChecked]=useState(false);
 const [faceApprovedPopup,setFaceApprovedPopup]=useState(false);
 const previousFaceEnrolled=useRef<boolean|undefined>(user?.onboarding?.faceEnrolled);

 useEffect(()=>{if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});},[]);
 useEffect(()=>{if(user?.role==='AUDITOR')setTab('auditoria');},[user?.role]);
 useEffect(()=>{
   if(!user){setOnboardingChecked(true);return;}
   setOnboardingChecked(false);
   api<any>('/auth/onboarding-status').then(onboarding=>{
     previousFaceEnrolled.current=Boolean(onboarding.faceEnrolled);
     const next={...user,onboarding};cacheUser(next);setUser(next);setOnboardingChecked(true);
   }).catch(()=>setOnboardingChecked(true));
 },[user?.id]);

 // Enquanto o servidor analisa as fotos, o usuário já navega normalmente.
 // Esta consulta leve promove a sessão para face ativa assim que o job terminar,
 // ou volta somente à etapa de fotos se o servidor pedir recaptura.
 useEffect(()=>{
   if(!user||user.onboarding?.required||user.onboarding?.faceEnrolled)return;
   const pending=Boolean(user.onboarding?.facePending)||['PENDING','PROCESSING'].includes(String(user.onboarding?.faceEnrollmentSubmissionStatus??''));
   if(!pending)return;
   const timer=window.setInterval(async()=>{
     try{
       const onboarding=await api<any>('/auth/onboarding-status');
       const wasFace=Boolean(previousFaceEnrolled.current);
       const nowFace=Boolean(onboarding.faceEnrolled);
       const next={...user,onboarding};cacheUser(next);setUser(next);
       if(!wasFace&&nowFace)setFaceApprovedPopup(true);
       previousFaceEnrolled.current=nowFace;
     }catch{}
   },3000);
   return()=>window.clearInterval(timer);
 },[user?.id,user?.onboarding?.required,user?.onboarding?.faceEnrolled,user?.onboarding?.facePending,user?.onboarding?.faceEnrollmentSubmissionStatus]);

 if(!user)return <Login onLogin={u=>{setUser(u);setOnboardingChecked(true);}}/>;
 if(!onboardingChecked)return <main className="login-shell"><section className="login-card"><h2>Validando primeiro acesso…</h2></section></main>;
 if(user.onboarding?.required)return <FirstAccessOnboarding user={user} onComplete={u=>{cacheUser(u);setUser(u);}}/>;
 const manager=['ADMIN','HR','SUPERVISOR'].includes(user.role); const auditor=['ADMIN','HR','AUDITOR'].includes(user.role); const employeeFlow=user.role!=='AUDITOR';
 const facePending=Boolean(user.onboarding?.facePending)||(!user.onboarding?.faceEnrolled&&['PENDING','PROCESSING'].includes(String(user.onboarding?.faceEnrollmentSubmissionStatus??'')));
 return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><div className="logo-mark small">PP</div><div><b>PontoProof</b><span>{user.tenant}</span></div></div><nav>{employeeFlow&&<><button className={tab==='ponto'?'active':''} onClick={()=>setTab('ponto')}>◉ Registrar ponto</button><button className={tab==='jornada'?'active':''} onClick={()=>setTab('jornada')}>◷ Minha jornada</button><button className={tab==='ajustes'?'active':''} onClick={()=>setTab('ajustes')}>↺ Ajustes</button><button className={tab==='seguranca-pessoal'?'active':''} onClick={()=>setTab('seguranca-pessoal')}>◈ Minha segurança</button></>}{manager&&<button className={tab==='gestao'?'active':''} onClick={()=>setTab('gestao')}>▦ Gestão</button>}{auditor&&<button className={tab==='auditoria'?'active':''} onClick={()=>setTab('auditoria')}>⌁ Auditoria</button>}</nav><div className="sidebar-user"><div className="avatar">{user.name.slice(0,2).toUpperCase()}</div><div><b>{user.name}</b><span>{user.role}</span></div><button onClick={()=>{clearToken();setUser(null)}}>Sair</button></div></aside><main className="content"><header><div><div className="eyebrow">SISTEMA OPERACIONAL DE JORNADA</div><h1>{tab==='ponto'?'Registrar ponto':tab==='jornada'?'Minha jornada':tab==='ajustes'?'Ajustes de jornada':tab==='seguranca-pessoal'?'Minha segurança':tab==='gestao'?'Central de gestão':'Auditoria e integridade'}</h1></div><div className="live-badge"><i/> Integridade ativa</div></header>
 {facePending&&<div className="face-analysis-banner"><b>Reconhecimento facial em análise</b><span>Você já pode usar o sistema. Enquanto a análise termina, as marcações exigem sua biometria digital/passkey. Quando a face for aprovada, o ponto passará a exigir digital + reconhecimento facial.</span></div>}
 {tab==='ponto'&&<PunchPanel/>}{tab==='jornada'&&<MyJourney/>}{tab==='ajustes'&&<Adjustments/>}{tab==='seguranca-pessoal'&&<SecurityCenter/>}{tab==='gestao'&&manager&&<Management/>}{tab==='auditoria'&&auditor&&<Audit/>}</main>
 {faceApprovedPopup&&<div className="status-popup-backdrop"><div className="status-popup approved"><div className="status-popup-icon">✓</div><h2>Reconhecimento facial aprovado</h2><p>Seu cadastro facial foi ativado. A partir de agora, cada marcação de jornada exigirá <b>biometria digital/passkey + reconhecimento facial</b>.</p><button className="primary success-button" onClick={()=>setFaceApprovedPopup(false)}>Entendi</button></div></div>}
 </div>;
}
