export interface WorkerEnv {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: R2Bucket;
  JWT_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  GEMINI_API_KEY?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  ABUSE_DIGEST_EMAIL?: string;
  ALLOWED_ORIGINS?: string;
  ADMIN_ALLOWED_ORIGINS?: string;
  ADMIN_ACCESS_TEAM_DOMAIN?: string;
  ADMIN_ACCESS_AUD?: string;
  ADMIN_ALLOWED_EMAILS?: string;
  ADMIN_ALERT_EMAIL?: string;
  ADMIN_ALERT_WEBHOOK_URL?: string;
  ADMIN_AI_COST_THRESHOLD_USD?: string;
  GEMINI_INPUT_USD_PER_MILLION?: string;
  GEMINI_OUTPUT_USD_PER_MILLION?: string;
  R2_STORAGE_USD_PER_GB_MONTH?: string;
  D1_READ_USD_PER_MILLION?: string;
  D1_WRITE_USD_PER_MILLION?: string;
}

export interface AuthClaims {
  accountId: string;
  deviceId: string;
  iat: number;
  exp: number;
}
