// Sign-in through Amazon Cognito's managed login, as an OAuth 2 authorisation
// code flow with PKCE and no client secret. A successful sign-in becomes a
// server-side session; the browser holds only a random token in an httpOnly cookie.
import { createHash, randomBytes } from "node:crypto";

const DOMAIN = process.env.COGNITO_DOMAIN?.replace(/\/$/, "");
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const POOL_ID = process.env.COGNITO_USER_POOL_ID;
// Cognito user pools are issued from cognito-idp unless a test points elsewhere.
const ISSUER = process.env.COGNITO_ISSUER ?? (POOL_ID && `https://cognito-idp.${POOL_ID.split("_")[0]}.amazonaws.com/${POOL_ID}`);
const APP_URL = (process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, "");
const REDIRECT_URI = `${APP_URL}/auth/callback`;
const SESSION_COOKIE = "cs_session";
const FLOW_COOKIE = "cs_signin";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const FLOW_MS = 10 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 10 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
// Secure works on localhost too. Lax lets the cookie ride the top-level
// redirect back from Cognito but keeps it off cross-site POSTs.
const COOKIE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };

export const authConfigured = Boolean(DOMAIN && CLIENT_ID && ISSUER);
export const cognitoOrigin = DOMAIN && new URL(DOMAIN).origin;

const hash = (value) => createHash("sha256").update(value).digest("hex");
const random = () => randomBytes(32).toString("base64url");

const cookie = (req, name) => {
  for (const part of String(req.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
};

// The signed-in person for this request, or undefined.
export const userOf = (req, db) => {
  const token = cookie(req, SESSION_COOKIE);
  if (!token || !TOKEN.test(token)) return undefined;
  const session = db.getSession(hash(token));
  return session && { ownerId: session.owner_id, email: session.email, sessionHash: hash(token) };
};

// Where to send the browser to sign in. `google` skips the choice on Cognito's page.
export const signInUrl = (res, { google = false } = {}) => {
  const state = random();
  const verifier = random();
  res.cookie(FLOW_COOKIE, `${state}.${verifier}`, { ...COOKIE, maxAge: FLOW_MS });
  const url = new URL(`${DOMAIN}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid email profile",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...(google && { identity_provider: "Google" }),
  });
  return url.href;
};

const claims = (idToken) => {
  try {
    return JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
};

// Finish a sign-in. Returns the new owner, or a reason it failed. The ID token
// comes straight from Cognito's token endpoint over TLS in exchange for a code
// bound to our PKCE verifier, so its issuer is trusted without a signature
// check (OpenID Connect Core 3.1.3.7); its issuer, audience and expiry are still checked.
export const finishSignIn = async (req, res, db, { fetch: post = fetch } = {}) => {
  const flow = cookie(req, FLOW_COOKIE) ?? "";
  res.clearCookie(FLOW_COOKIE, COOKIE);
  const [state, verifier] = flow.split(".");
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (req.query.error) return { problem: "cancelled" };
  if (!state || !verifier || req.query.state !== state || !code) return { problem: "expired" };

  let token;
  try {
    const response = await post(`${DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, code, redirect_uri: REDIRECT_URI, code_verifier: verifier }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!response.ok) return { problem: "rejected", status: response.status };
    token = claims((await response.json()).id_token);
  } catch (error) {
    return { problem: "unreachable", reason: error.message };
  }
  const audience = Array.isArray(token?.aud) ? token.aud : [token?.aud];
  if (!token?.sub || token.iss !== ISSUER || !audience.includes(CLIENT_ID) || token.token_use !== "id" || token.exp * 1000 < Date.now()) {
    return { problem: "invalid" };
  }

  const ownerId = hash(`cognito:${token.sub}`);
  const session = random();
  db.touchOwner(ownerId, typeof token.email === "string" ? token.email : null);
  db.createSession(hash(session), ownerId, new Date(Date.now() + SESSION_MS).toISOString());
  res.cookie(SESSION_COOKIE, session, { ...COOKIE, maxAge: SESSION_MS });
  return { ownerId };
};

// End the session here, then at Cognito, so the next sign-in asks again.
export const signOut = (req, res, db) => {
  const user = userOf(req, db);
  if (user) db.deleteSession(user.sessionHash);
  res.clearCookie(SESSION_COOKIE, COOKIE);
  const url = new URL(`${DOMAIN}/logout`);
  url.search = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: `${APP_URL}/` });
  return url.href;
};
