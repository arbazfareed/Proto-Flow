import { Hono } from "hono";
import { requireJwt } from "./auth";
import type { WorkerEnv } from "./env";
import { errorResponse } from "./errors";

type AppEnvironment = { Bindings: WorkerEnv };

export const app = new Hono<AppEnvironment>();

app.use("*", async (context, next) => {
  const origin = context.req.header("Origin");
  const allowedOrigins = (context.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (origin && !allowedOrigins.includes(origin)) {
    return errorResponse(
      context,
      403,
      "ORIGIN_NOT_ALLOWED",
      "This origin is not allowed to access the API.",
    );
  }

  if (origin) {
    context.header("Access-Control-Allow-Origin", origin);
    context.header("Vary", "Origin");
    context.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    context.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    context.header("Access-Control-Max-Age", "86400");
  }

  if (context.req.method === "OPTIONS") return context.body(null, 204);
  await next();
});

app.onError((error, context) => {
  console.error("Unhandled Worker request error.", {
    message: error.message,
    path: context.req.path,
    method: context.req.method,
  });
  return errorResponse(context, 500, "INTERNAL_ERROR", "An unexpected server error occurred.");
});

app.notFound((context) =>
  errorResponse(context, 404, "NOT_FOUND", "The requested route does not exist."),
);

app.get("/health", (context) => context.json({ status: "ok" }));

app.post("/auth/anonymous", (context) =>
  errorResponse(
    context,
    501,
    "AUTH_NOT_IMPLEMENTED",
    "Anonymous wallet provisioning is scheduled for a later task.",
  ),
);

app.get("/wallet/me", requireJwt, (context) =>
  errorResponse(
    context,
    501,
    "WALLET_NOT_IMPLEMENTED",
    "Wallet reads are scheduled for a later task.",
  ),
);

app.post("/wallet/claim-daily", requireJwt, (context) =>
  errorResponse(
    context,
    501,
    "WALLET_NOT_IMPLEMENTED",
    "Daily wallet grants are scheduled for a later task.",
  ),
);

app.post("/action/run", requireJwt, (context) =>
  errorResponse(
    context,
    501,
    "ACTION_NOT_IMPLEMENTED",
    "Metered actions are scheduled for a later task.",
  ),
);

app.post("/auth/email/start", (context) =>
  errorResponse(
    context,
    501,
    "AUTH_NOT_IMPLEMENTED",
    "Email sign-in is scheduled for Task PF-T307.",
  ),
);

app.post("/auth/email/verify", (context) =>
  errorResponse(
    context,
    501,
    "AUTH_NOT_IMPLEMENTED",
    "Email sign-in is scheduled for Task PF-T307.",
  ),
);

app.all("/admin/*", requireJwt, (context) =>
  errorResponse(
    context,
    501,
    "ADMIN_NOT_IMPLEMENTED",
    "Administrative operations are scheduled for Task PF-T310.",
  ),
);

export default app;
