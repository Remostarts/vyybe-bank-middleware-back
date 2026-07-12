export interface AppConfig {
  port: number;
  databaseUrl: string;
  blnkBaseUrl: string;
  blnkApiKey: string;
  /** api key -> calling service name */
  serviceApiKeys: ReadonlyMap<string, string>;
  vanPrefix: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const required = (name: string): string => {
    const v = env[name];
    if (!v || v.trim() === '') throw new Error(`Missing required env var: ${name}`);
    return v.trim();
  };

  const serviceApiKeys = new Map<string, string>();
  for (const pair of required('SERVICE_API_KEYS').split(',')) {
    const idx = pair.indexOf(':');
    if (idx <= 0 || idx === pair.length - 1) {
      throw new Error(`Malformed SERVICE_API_KEYS entry "${pair}" (expected name:key)`);
    }
    serviceApiKeys.set(pair.slice(idx + 1).trim(), pair.slice(0, idx).trim());
  }

  const vanPrefix = (env.VAN_PREFIX ?? '99').trim();
  if (!/^\d{0,8}$/.test(vanPrefix)) throw new Error('VAN_PREFIX must be 0-8 digits');

  return {
    port: parseInt(env.PORT ?? '3000', 10),
    databaseUrl: required('DATABASE_URL'),
    blnkBaseUrl: required('BLNK_BASE_URL').replace(/\/+$/, ''),
    blnkApiKey: required('BLNK_API_KEY'),
    serviceApiKeys,
    vanPrefix,
  };
}
