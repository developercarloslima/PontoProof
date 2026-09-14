import { FormEvent, useState } from 'react';
import { api, cacheUser, setToken, SessionUser } from '../lib/api';
import { loginWithPlatformBiometric, supportsWebAuthn } from '../lib/webauthn';
import FaceLoginCapture from './FaceLoginCapture';

type Props = { onLogin: (user: SessionUser) => void };

type LoginResponse={token:string;user:SessionUser};

export default function Login({ onLogin }: Props) {
  const [email, setEmail] = useState('colaborador@demo.com');
  const [password, setPassword] = useState('Demo@123');
  const [tenantDocument, setTenantDocument] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [faceChallengeId,setFaceChallengeId]=useState<string|null>(null);

  function finishLogin(data:LoginResponse){setToken(data.token);cacheUser(data.user);onLogin(data.user);}

  async function submit(e: FormEvent) {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const data = await api<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, ...(tenantDocument ? { tenantDocument } : {}) }) });
      finishLogin(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha no login'); }
    finally { setLoading(false); }
  }

  async function loginDigital(){
    if(!email)return setError('Informe seu e-mail antes de usar a biometria digital.');
    setLoading(true);setError('');
    try{const data=await loginWithPlatformBiometric(email,tenantDocument||undefined) as LoginResponse;finishLogin(data);}
    catch(e){setError(e instanceof Error?e.message:'Não foi possível entrar com biometria digital');}
    finally{setLoading(false);}
  }

  async function openFaceLogin(){
    if(!email)return setError('Informe seu e-mail antes de usar o reconhecimento facial.');
    setLoading(true);setError('');
    try{const res=await api<{challengeId:string}>('/auth/face/options',{method:'POST',body:JSON.stringify({email,...(tenantDocument?{tenantDocument}:{})})});setFaceChallengeId(res.challengeId);}
    catch(e){setError(e instanceof Error?e.message:'Não foi possível iniciar o login facial');}
    finally{setLoading(false);}
  }

  async function verifyFace(images:string[]){
    if(!faceChallengeId)return;
    try{const data=await api<LoginResponse>('/auth/face/verify',{method:'POST',body:JSON.stringify({challengeId:faceChallengeId,images})});setFaceChallengeId(null);finishLogin(data);}
    catch(e){setFaceChallengeId(null);setError(e instanceof Error?e.message:'Não foi possível confirmar o rosto');throw e;}
  }

  return <main className="login-shell">
    <section className="brand-panel">
      <div className="logo-mark">PP</div>
      <h1>PontoProof</h1>
      <p>Jornada verificável, antifraude e explicável — sem apagar a história.</p>
      <div className="trust-row"><span>Hash encadeado</span><span>Prova de presença</span><span>Correção auditável</span><span>Jornada Espelho</span></div>
    </section>
    <form className="login-card" onSubmit={submit}>
      <div className="eyebrow">AMBIENTE PONTO PROOF</div>
      <h2>Acessar plataforma</h2>
      <label>E-mail<input value={email} onChange={e => setEmail(e.target.value)} type="email" /></label>
      <label>Senha<input value={password} onChange={e => setPassword(e.target.value)} type="password" /></label>
      <label>Empresa / CNPJ <span className="optional">opcional</span><input value={tenantDocument} onChange={e => setTenantDocument(e.target.value)} placeholder="Use apenas se o e-mail existir em mais de uma empresa" /></label>
      {error && <div className="error-box">{error}</div>}
      <button className="primary" disabled={loading}>{loading ? 'Aguarde...' : 'Entrar com senha'}</button>
      <div className="login-biometric-divider"><span>ou entre sem senha</span></div>
      <div className="login-biometric-actions">
        <button type="button" className="secondary-action" disabled={loading||!supportsWebAuthn()} onClick={loginDigital}>◉ Biometria digital / passkey</button>
        <button type="button" className="secondary-action" disabled={loading} onClick={openFaceLogin}>◎ Reconhecimento facial</button>
      </div>
      {!supportsWebAuthn()&&<small>Biometria digital indisponível neste navegador; senha e reconhecimento facial continuam disponíveis.</small>}
      <small>Demo inicial: colaborador@demo.com / Demo@123</small>
    </form>
    {faceChallengeId&&<FaceLoginCapture onCapture={verifyFace} onCancel={()=>setFaceChallengeId(null)}/>} 
  </main>;
}
