export function getApiUrl(path: string): string {
  if (path.startsWith('http')) return path;
  
  const serverIp = localStorage.getItem('tvapp_server_ip') || '';
  if (serverIp) {
    const baseUrl = serverIp.endsWith('/') ? serverIp.slice(0, -1) : serverIp;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    // If the server IP doesn't have a protocol, assume http://
    const finalBase = baseUrl.startsWith('http') ? baseUrl : `http://${baseUrl}`;
    return `${finalBase}${cleanPath}`;
  }
  
  return path;
}
