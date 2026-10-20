export interface WorkerEnv {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: R2Bucket;
  JWT_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  ALLOWED_ORIGINS?: string;
}

export interface AuthClaims {
  accountId: string;
  deviceId: string;
  iat: number;
  exp: number;
}
