import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { authorizeAccess } from '../lib/access.ts';

const env = { REQUIRE_ACCESS: 'true', ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'job-agent' };
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey);
const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'RS256', use: 'sig' }] });
async function signed(aud = 'job-agent', exp = '5m') {
  return new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer('https://test.cloudflareaccess.com').setSubject('owner').setAudience(aud)
    .setIssuedAt().setExpirationTime(exp).sign(privateKey);
}
const request = token => new Request('https://example.com/api/documents?id=private', { headers: token ? { 'cf-access-jwt-assertion': token } : {} });
test('production denies requests before Access is configured', async () => {
  assert.equal((await authorizeAccess(request(), { REQUIRE_ACCESS: 'true' })).status, 503);
});
test('production rejects missing and forged assertions, including with ingest token', async () => {
  assert.equal((await authorizeAccess(request(), env, keys)).status, 403);
  assert.equal((await authorizeAccess(request('forged'), env, keys)).status, 403);
  const req = request(); req.headers.set('x-ingest-token', 'not-browser-auth');
  assert.equal((await authorizeAccess(req, env, keys)).status, 403);
});
test('valid signature alone does not authorize wrong audience or expired token', async () => {
  assert.equal((await authorizeAccess(request(await signed('another-app')), env, keys)).status, 403);
  assert.equal((await authorizeAccess(request(await signed('job-agent', '-1m')), env, keys)).status, 403);
});
test('valid Access token permits request; local development stays available', async () => {
  assert.equal(await authorizeAccess(request(await signed()), env, keys), null);
  assert.equal(await authorizeAccess(request(), {}), null);
});
