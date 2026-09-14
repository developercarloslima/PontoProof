import { FormEvent, useState } from 'react';
import { api, cacheUser, setToken, SessionUser } from '../lib/api';

type Props = { onLogin: (user: SessionUser) => void };
export default function Login({ onLogin }: Props) {
  const [email, setEmail] = useState('colaborador@demo.com');
  const [password, setPassword] = useState('Demo@123');
  const [tenantDocument, setTenantDocument] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const data = await api<{ token: string; user: SessionUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, ...(tenantDocument ? { tenantDocument } : {}) }) });
      setToken(data.token); cacheUser(data.user); onLogin(data.user);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha no login'); }
    finally { setLoading(false); }
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
      <button className="primary" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
      <small>Demo: colaborador@demo.com / Demo@123</small>
    </form>
  </main>;
}
