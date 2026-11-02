import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@gatehouse/contract';
import { api, clearSession, readToken, storeSession } from '../api/client';
import type { LoginResponse } from '../types/api';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const USER_KEY = 'dsh_console_user';
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as User; } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(readToken()));

  useEffect(() => {
    const expired = () => { clearSession(); setUser(null); };
    window.addEventListener('dsh:auth-expired', expired);
    return () => window.removeEventListener('dsh:auth-expired', expired);
  }, []);

  useEffect(() => {
    if (!readToken()) { setLoading(false); return; }
    api<{ user: User }>('/api/auth/me')
      .then((data) => { setUser(data.user); localStorage.setItem(USER_KEY, JSON.stringify(data.user)); })
      .catch(() => { clearSession(); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<LoginResponse>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }, false);
    storeSession(data.token, data.user);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => { clearSession(); setUser(null); }, []);
  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
