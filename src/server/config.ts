const localHosts = ['localhost', '127.0.0.1', '[::1]'];

export function serverConfig(env: NodeJS.ProcessEnv = process.env) {
  const host = env.HOST?.trim() || '127.0.0.1';
  const port = Number(env.PORT ?? 38100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const allowedHosts = new Set(localHosts);
  for (const value of (env.VERITAS_ALLOWED_HOSTS ?? '').split(',')) {
    const hostname = value.trim().toLowerCase();
    if (!hostname) continue;
    const parsed = new URL('http://' + hostname);
    if (hostname.includes('*') || parsed.hostname !== hostname || parsed.port || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('VERITAS_ALLOWED_HOSTS must contain comma-separated hostnames without ports');
    }
    allowedHosts.add(hostname);
  }
  return {host, port, allowedHosts};
}
