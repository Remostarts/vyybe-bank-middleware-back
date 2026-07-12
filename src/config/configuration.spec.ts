import { loadConfig } from './configuration';

const validEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  BLNK_BASE_URL: 'http://localhost:5001/',
  BLNK_API_KEY: 'secret',
  SERVICE_API_KEYS: 'user-service:key-1,social-service:key-2',
};

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.port).toBe(3000);
    expect(cfg.blnkBaseUrl).toBe('http://localhost:5001'); // trailing slash stripped
    expect(cfg.serviceApiKeys.get('key-1')).toBe('user-service');
    expect(cfg.serviceApiKeys.get('key-2')).toBe('social-service');
    expect(cfg.vanPrefix).toBe('99');
  });

  it.each(['DATABASE_URL', 'BLNK_BASE_URL', 'BLNK_API_KEY', 'SERVICE_API_KEYS'])(
    'throws when %s is missing',
    (name) => {
      const env = { ...validEnv } as Record<string, string>;
      delete env[name];
      expect(() => loadConfig(env)).toThrow(name);
    },
  );

  it('throws on malformed SERVICE_API_KEYS entry', () => {
    expect(() => loadConfig({ ...validEnv, SERVICE_API_KEYS: 'no-colon-here' })).toThrow('SERVICE_API_KEYS');
  });

  it('throws on non-digit VAN_PREFIX', () => {
    expect(() => loadConfig({ ...validEnv, VAN_PREFIX: 'ab' })).toThrow('VAN_PREFIX');
  });

  it('respects PORT and VAN_PREFIX overrides', () => {
    const cfg = loadConfig({ ...validEnv, PORT: '4000', VAN_PREFIX: '123' });
    expect(cfg.port).toBe(4000);
    expect(cfg.vanPrefix).toBe('123');
  });
});
