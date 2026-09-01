export function getApiUrl(path: string): string {
  if (path.startsWith('http')) return path;
  
  const serverIp = localStorage.getItem('tvapp_server_ip') || '';
  if (serverIp) {
    const baseUrl = serverIp.endsWith('/') ? serverIp.slice(0, -1) : serverIp;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const finalBase = baseUrl.startsWith('http') ? baseUrl : `http://${baseUrl}`;
    return `${finalBase}${cleanPath}`;
  }
  
  return path;
}

export function getActiveProfileId(): string {
  return localStorage.getItem('tvapp_active_profile_id') || '1';
}

export function getApiHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  const token = localStorage.getItem('tvapp_auth_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // Fallback for transition
  const profileId = getActiveProfileId();
  if (profileId) {
    headers['X-Profile-ID'] = profileId;
  }
  return headers;
}

const cache: Record<string, { data: any, timestamp: number }> = {};

export async function fetchWithCache(url: string, ttl = 5 * 60 * 1000) {
  // Append profile ID to cache key to isolate cache per-profile
  const profileId = getActiveProfileId();
  const cacheKey = `${profileId}:${url}`;

  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < ttl) {
    return cache[cacheKey].data;
  }
  const res = await fetch(url, { headers: getApiHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  cache[cacheKey] = { data, timestamp: Date.now() };
  return data;
}

export function clearApiCache() {
  for (const key in cache) delete cache[key];
}
