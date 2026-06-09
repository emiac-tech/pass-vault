import 'dotenv/config';

const required = (key: string, fallback?: string) => {
  const value = process.env[key] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.API_PORT ?? 4000),
  databaseUrl: required('DATABASE_URL', 'postgres://pass_vault:pass_vault@localhost:5432/pass_vault'),
  jwtSecret: required('JWT_SECRET', 'dev-only-change-this-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  appOrigins: (process.env.APP_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim()),
  // Public base URL used to build links inside emails (invite acceptance, etc.).
  publicAppUrl: (process.env.PUBLIC_APP_URL ?? 'http://localhost:4000').replace(/\/+$/, ''),
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: (process.env.SMTP_SECURE ?? (process.env.SMTP_PORT === '465' ? 'true' : 'false')) === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '',
    fromName: process.env.SMTP_FROM_NAME ?? 'E-Vault Password Manager',
  },
};
