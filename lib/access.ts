import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";

export type AccessEnv = {
  REQUIRE_ACCESS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Production fails closed, including when Access has not been configured yet. */
export async function authorizeAccess(request: Request, env: AccessEnv, testKeys?: JWTVerifyGetKey): Promise<Response | null> {
  if (env.REQUIRE_ACCESS !== "true") return null;
  const domain = env.ACCESS_TEAM_DOMAIN;
  if (!domain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !env.ACCESS_AUD) {
    return new Response("Access configuration is pending.", { status: 503, headers: { "cache-control": "no-store" } });
  }
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!assertion) return new Response("Sign in through Cloudflare Access.", { status: 403 });
  try {
    let keys = testKeys ?? keySets.get(domain);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
      keySets.set(domain, keys as ReturnType<typeof createRemoteJWKSet>);
    }
    await jwtVerify(assertion, keys, {
      issuer: `https://${domain}`,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub"],
    });
    return null;
  } catch {
    return new Response("Invalid Access session.", { status: 403, headers: { "cache-control": "no-store" } });
  }
}
