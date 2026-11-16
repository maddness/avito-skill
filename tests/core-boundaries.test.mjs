import {fileURLToPath} from 'node:url';
import './isolate-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transport, Pacer } from '../scripts/lib/transport.mjs';
import { Client } from '../scripts/lib/client.mjs';
import { importSession } from '../scripts/lib/session.mjs';
import { writeJson } from '../scripts/lib/storage.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const auth = { profile_id: 'TEST_PROFILE', cookies: [{ name: 'test_cookie', value: 'OFFLINE_TEST_ONLY', domain: '.avito.ru', path: '/', secure: true, expires: -1 }] };
const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
async function fixture(run) {
  const dir = await fs.mkdtemp(path.join(root, 'boundary-fixture-'));
  try { return await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('fresh Transport instances share a persistent pause after the previous request', () => fixture(async stateDir => {
  const pauses = [];
  const fresh = () => new Transport(auth, { stateDir, pacer: new Pacer({ random: () => 0, sleep: async ms => pauses.push(ms) }), fetchImpl: async () => response({ status: 'ok' }) });
  await fresh().request('/web/1/profiles/list');
  await fresh().request('/web/1/profiles/list');
  assert.deepEqual(pauses, [300]);
}));

test('different Transport instances serialize ordinary requests through network.lock', () => fixture(async stateDir => {
  const pauses = [];
  let active = 0, maximum = 0;
  const fresh = () => new Transport(auth, { stateDir, pacer: new Pacer({ random: () => 0.999999, sleep: async ms => pauses.push(ms) }), fetchImpl: async () => {
    active++; maximum = Math.max(active, maximum);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return response({ status: 'ok' });
  } });
  await Promise.all([fresh().request('/web/1/profiles/list'), fresh().request('/web/1/profiles/list')]);
  assert.equal(maximum, 1);
  assert.deepEqual(pauses, [600]);
}));

test('429 cooldown survives construction of a new Transport', () => fixture(async stateDir => {
  let calls = 0;
  const fresh = () => new Transport(auth, { stateDir, pacer: new Pacer({ sleep: async () => {} }), fetchImpl: async () => {
    calls++;
    return new Response('{}', { status: 429, headers: { 'retry-after': '15' } });
  } });
  await assert.rejects(fresh().request('/web/1/profiles/list'), { code: 'RATE_LIMITED' });
  await assert.rejects(fresh().request('/web/1/profiles/list'), { code: 'RATE_LIMITED' });
  assert.equal(calls, 1);
}));

test('known prohibited financial paths are rejected with POST before fetch', async () => {
  let calls = 0;
  const transport = new Transport(auth, { fetchImpl: async () => { calls++; return response({}); } });
  for (const url of ['/web/1/payment/create', '/web/1/orders/create', '/web/1/vas/purchase', 'https://evil.invalid/web/1/profiles/list']) {
    await assert.rejects(transport.request(url, { method: 'POST', json: {} }), { code: 'ENDPOINT_NOT_ALLOWED' });
  }
  assert.equal(calls, 0);
});

test('Client rejects a method outside its RPC capability allowlist', async () => {
  let calls = 0;
  const client = new Client(auth, { transport: { request: async () => { calls++; return response({}); } } });
  await assert.rejects(client.rpc('not.an.allowed.method', {}, { write: true }), { code: 'RPC_NOT_ALLOWED' });
  assert.equal(calls, 0);
});

test('profile mismatch is classified before use of account-specific helpers', async () => {
  const client = new Client(auth, { transport: { request: async () => ({ result: { profiles: [{ isCurrent: true, profileId: 'OTHER_TEST_PROFILE' }] } }) } });
  await assert.rejects(client.identity(), { code: 'PROFILE_MISMATCH' });
});

test('session import is private and does not return cookie values', () => fixture(async dir => {
  const source = path.join(dir, 'import.json'), stateDir = path.join(dir, 'state');
  await writeJson(source, auth);
  const result = await importSession(source, stateDir, { fetchImpl: async () => response({ result: { profiles: [{ isCurrent: true, profileId: auth.profile_id }] } }) });
  assert.equal(JSON.stringify(result).includes('OFFLINE_TEST_ONLY'), false);
  assert.equal((await fs.stat(path.join(stateDir, 'session.json'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(stateDir)).mode & 0o777, 0o700);
}));

test('request trace contains no cookie value and redirect follows no destination', async () => {
  let recordedOptions;
  const transport = new Transport(auth, { fetchImpl: async (url, options) => {
    recordedOptions = options;
    return new Response('', { status: 302, headers: { location: 'https://evil.invalid/' } });
  } });
  await assert.rejects(transport.request('/web/1/profiles/list'), { code: 'REDIRECT_BLOCKED' });
  assert.equal(recordedOptions.redirect, 'manual');
  assert.equal(JSON.stringify(transport.trace).includes('OFFLINE_TEST_ONLY'), false);
});
