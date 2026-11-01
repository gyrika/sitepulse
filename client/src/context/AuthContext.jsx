import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setSessionExpiredHandler } from '../api/client.js';

const AuthContext = createContext(null);

// The browser cannot read the HttpOnly cookie, which is the point, so it asks the server.
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading'); // loading | signedIn | signedOut | unreachable
  const [error, setError] = useState(null);

  const checkSession = useCallback(async () => {
    setStatus('loading');
    try {
      const { authenticated } = await api.getSession();
      setStatus(authenticated ? 'signedIn' : 'signedOut');
    } catch (requestError) {
      setError(requestError);
      setStatus('unreachable');
    }
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => setStatus('signedOut'));
    checkSession();
  }, [checkSession]);

  const value = useMemo(
    () => ({
      status,
      error,
      retry: checkSession,
      login: async (password) => {
        await api.login(password);
        setStatus('signedIn');
      },
      logout: async () => {
        await api.logout();
        setStatus('signedOut');
      },
    }),
    [status, error, checkSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
