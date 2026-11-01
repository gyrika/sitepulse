export class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onSessionExpired = () => {};

// AuthContext registers here, so any call that finds the session expired signs the user out.
export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

async function request(path, { method = 'GET', body, query } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) params.set(key, value);
  }
  const search = params.size > 0 ? `?${params}` : '';

  let response;
  try {
    response = await fetch(`/api${path}${search}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }

  if (response.status === 204) return null;

  // A proxy or crashed server may answer with something that is not JSON.
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload?.error;
    if (error?.code === 'UNAUTHORIZED') onSessionExpired();
    throw new ApiError(
      response.status,
      error?.code ?? 'SERVER_ERROR',
      error?.message ?? 'The server is not responding correctly. Try again shortly.',
      error?.details,
    );
  }
  return payload;
}

const data = (promise) => promise.then((payload) => payload?.data);

export const api = {
  getSession: () => data(request('/auth/session')),
  login: (password) => data(request('/auth/login', { method: 'POST', body: { password } })),
  logout: () => request('/auth/logout', { method: 'POST' }),

  getSummary: () => data(request('/dashboard/summary')),

  listMonitors: () => data(request('/monitors')),
  getMonitor: (id) => data(request(`/monitors/${id}`)),
  createMonitor: (body) => data(request('/monitors', { method: 'POST', body })),
  updateMonitor: (id, body) => data(request(`/monitors/${id}`, { method: 'PATCH', body })),
  deleteMonitor: (id) => request(`/monitors/${id}`, { method: 'DELETE' }),
  runCheck: (id) => data(request(`/monitors/${id}/check`, { method: 'POST' })),
  listChecks: (id, query) => data(request(`/monitors/${id}/checks`, { query })),
  listIncidents: (id, query) => data(request(`/monitors/${id}/incidents`, { query })),
};
