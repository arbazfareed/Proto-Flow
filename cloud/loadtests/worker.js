import crypto from "k6/crypto";
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const targetRates = {
  health: 1,
  anonymous_auth: 500,
  wallet_me: 1000,
  wallet_claim_daily: 100,
  action_ai: 50,
  action_publish: 20,
  action_export: 20,
  action_collaboration: 5,
};

const scenario = __ENV.SCENARIO || "wallet_me";
const profile = __ENV.PROFILE || "smoke";
const rejectedRequests = new Counter("expected_rejections");
const validProfiles = new Set(["smoke", "baseline", "target"]);
const validScenarios = new Set(Object.keys(targetRates));
const isLocal = (hostname) => ["localhost", "127.0.0.1", "::1"].includes(hostname);

if (!validScenarios.has(scenario)) {
  throw new Error(`Unsupported SCENARIO. Choose: ${[...validScenarios].join(", ")}.`);
}
if (!validProfiles.has(profile)) {
  throw new Error("PROFILE must be smoke, baseline, or target.");
}

if (profile === "target" && __ENV.LOADTEST_ACK !== "I_CONFIRM_AUTHORIZED_STAGING") {
  throw new Error("Target-rate runs require LOADTEST_ACK=I_CONFIRM_AUTHORIZED_STAGING.");
}

const rate = profile === "smoke"
  ? 1
  : profile === "baseline"
    ? Math.max(1, Math.floor(targetRates[scenario] / 10))
    : targetRates[scenario];
const duration = profile === "smoke" ? "30s" : "10m";

export const options = {
  scenarios: {
    worker: {
      executor: "constant-arrival-rate",
      rate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: Math.min(500, Math.max(5, rate * 2)),
      maxVUs: Math.min(2000, Math.max(20, rate * 4)),
      exec: "runRequest",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<200"],
    http_req_failed: ["rate<0.005"],
    dropped_iterations: ["count<1"],
  },
};

export function setup() {
  const target = __ENV.TARGET_URL;
  const allowedHost = (__ENV.LOADTEST_ALLOWED_HOST || "").toLowerCase();
  if (!target || !allowedHost || __ENV.LOADTEST_TARGET_CLASS !== "staging") {
    throw new Error(
      "Set TARGET_URL, exact LOADTEST_ALLOWED_HOST, and LOADTEST_TARGET_CLASS=staging.",
    );
  }
  if (__ENV.LOADTEST_ACK !== "I_CONFIRM_AUTHORIZED_STAGING") {
    throw new Error("Set LOADTEST_ACK=I_CONFIRM_AUTHORIZED_STAGING to confirm authorization.");
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error("TARGET_URL must be an absolute URL.");
  }
  if (
    parsed.hostname.toLowerCase() !== allowedHost ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal(parsed.hostname)))
  ) {
    throw new Error("TARGET_URL must be an HTTPS staging origin matching LOADTEST_ALLOWED_HOST.");
  }
  if (parsed.hostname === "protoflow.app" || parsed.hostname.endsWith(".protoflow.app")) {
    throw new Error("Production ProtoFlow domains cannot be used by this load-test harness.");
  }

  const health = http.get(`${parsed.origin}/health`, { tags: { name: "health_check" } });
  if (health.status !== 200) {
    throw new Error(`Staging health check failed with HTTP ${health.status}.`);
  }
  return { origin: parsed.origin };
}

function uuidV4() {
  const bytes = new Uint8Array(crypto.randomBytes(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function actionTypeFor(selectedScenario) {
  return {
    action_ai: "ai_interaction_generator",
    action_publish: "cloud_preview_publish",
    action_export: "react_tailwind_code_export",
    action_collaboration: "collaboration_session",
  }[selectedScenario];
}

function requestFor(selectedScenario, origin) {
  if (selectedScenario === "anonymous_auth") {
    const seed = `${__VU}:${__ITER}:${Date.now()}:${Math.random()}`;
    const installId = uuidV4();
    const deviceId = crypto.sha256(seed, "hex");
    return {
      method: "POST",
      url: `${origin}/auth/anonymous`,
      body: JSON.stringify({ deviceId, installId }),
      headers: { "Content-Type": "application/json" },
    };
  }
  if (selectedScenario === "health") {
    return { method: "GET", url: `${origin}/health`, headers: {} };
  }

  const token = __ENV.LOADTEST_TOKEN;
  if (!token) throw new Error("Protected scenarios require LOADTEST_TOKEN.");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (selectedScenario === "wallet_me") {
    return { method: "GET", url: `${origin}/wallet/me`, headers };
  }
  if (selectedScenario === "wallet_claim_daily") {
    return { method: "POST", url: `${origin}/wallet/claim-daily`, headers, body: "{}" };
  }

  let payload;
  try {
    payload = JSON.parse(__ENV.ACTION_PAYLOAD_JSON || "");
  } catch {
    throw new Error("ACTION_PAYLOAD_JSON must contain a valid synthetic action payload.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("ACTION_PAYLOAD_JSON must be a JSON object.");
  }
  return {
    method: "POST",
    url: `${origin}/action/run`,
    body: JSON.stringify({ type: actionTypeFor(selectedScenario), payload }),
    headers,
  };
}

export function runRequest(data) {
  const request = requestFor(scenario, data.origin);
  const response = http.request(request.method, request.url, request.body, {
    headers: request.headers,
    tags: { scenario },
    responseCallback: (res) =>
      (res.status >= 200 && res.status < 300) || [402, 409, 429].includes(res.status),
  });
  const expected = (response.status >= 200 && response.status < 300) ||
    [402, 409, 429].includes(response.status);
  if ([402, 409, 429].includes(response.status)) rejectedRequests.add(1, { scenario });
  check(response, {
    "response succeeds or is a documented wallet/rate-limit rejection": () => expected,
  });
}
