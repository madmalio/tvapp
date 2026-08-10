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

const cache: Record<string, { data: any, timestamp: number }> = {};

export async function fetchWithCache(url: string, ttl = 5 * 60 * 1000) {
  if (cache[url] && Date.now() - cache[url].timestamp < ttl) {
    return cache[url].data;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  cache[url] = { data, timestamp: Date.now() };
  return data;
}

export function clearApiCache() {
  for (const key in cache) delete cache[key];
}
