const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

export type SessionUser = {
  id: string;
  email: string;
  role: string;
  employeeId?: string;
  name: string;
  tenant: string;
  onboarding?: { required:boolean; mustChangePassword:boolean; passwordChanged:boolean; biometricNoticeAcknowledged:boolean; faceEnrolled:boolean; platformBiometricEnrolled:boolean; completed:boolean; completedAt?:string|null };
};

export function getToken() { return localStorage.getItem('pontoproof_token'); }
export function setToken(token: string) { localStorage.setItem('pontoproof_token', token); }
export function clearToken() { localStorage.removeItem('pontoproof_token'); localStorage.removeItem('pontoproof_user'); }
export function getCachedUser(): SessionUser | null {
  const raw = localStorage.getItem('pontoproof_user');
  return raw ? JSON.parse(raw) : null;
}
export function cacheUser(user: SessionUser) { localStorage.setItem('pontoproof_user', JSON.stringify(user)); }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Erro HTTP ${response.status}`);
  return data;
}
