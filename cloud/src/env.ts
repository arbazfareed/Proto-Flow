export interface WorkerEnv {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: R2Bucket;
  JWT_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  ALLOWED_ORIGINS?: string;
}

export interface AuthClaims {
  accountId: string;
  deviceId: string;
  iat: number;
  exp: number;
}
