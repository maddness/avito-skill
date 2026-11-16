import {fileURLToPath} from 'node:url';
import './isolate-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importSession } from '../scripts/lib/session.mjs';
import { writeJson, readJson } from '../scripts/lib/storage.mjs';

globalThis.fetch = async () => { throw new Error('Live network prohibited in session review'); };
const root = path.dirname(fileURLToPath(import.meta.url));
const cookies = marker => [{ name: 'offline_fixture', value: marker, domain: '.avito.ru', path: '/', secure: true, expires: -1 }];
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
async function fixture(callback) {
  const dir = await fs.mkdtemp(path.join(root, 'session-fixture-'));
  const stateDir = path.join(dir, 'state'), oldFile = path.join(stateDir, 'session.json'), source = path.join(dir, 'candidate.json');
  await writeJson(oldFile, { schema_version: 1, binding_id: 'TEST_BINDING', profile_id: 'TEST_PROFILE', cookies: cookies('OLD_FAKE'), timezone: 'Europe/Moscow' });
  await writeJson(source, { profile_id: 'TEST_PROFILE', cookies: cookies('NEW_FAKE') });
  const original = await fs.readFile(oldFile, 'utf8');
  try { await callback({ stateDir, source, oldFile, original }); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

for (const [label, fetchImpl, code] of [
  ['wrong current profile', async () => json({ result: { profiles: [{ isCurrent: true, profileId: 'OTHER_TEST_PROFILE' }] } }), 'PROFILE_MISMATCH'],
  ['expired authentication', async () => json({}, 401), 'AUTH_REQUIRED'],
  ['network failure', async () => { throw new Error('Offline simulated timeout'); }, 'NETWORK_ERROR'],
]) {
  test(`failed candidate import preserves original session bytes: ${label}`, () => fixture(async f => {
    await assert.rejects(importSession(f.source, f.stateDir, { fetchImpl }), { code });
    assert.equal(await fs.readFile(f.oldFile, 'utf8'), f.original);
  }));
}

test('verified import keeps binding and private mode without returning cookie values', () => fixture(async f => {
  const result = await importSession(f.source, f.stateDir, { fetchImpl: async () => json({ result: { profiles: [{ isCurrent: true, profileId: 'TEST_PROFILE' }] } }) });
  const saved = await readJson(f.oldFile, { privateFile: true });
  assert.equal(result.verified, true); assert.equal(result.binding_id, 'TEST_BINDING');
  assert.equal(saved.cookies[0].value, 'NEW_FAKE');
  assert.equal(JSON.stringify(result).includes('NEW_FAKE'), false);
  assert.equal((await fs.stat(f.oldFile)).mode & 0o777, 0o600);
}));

test('insecure source permissions fail before a request or session replacement', () => fixture(async f => {
  await fs.chmod(f.source, 0o644);
  let calls = 0;
  await assert.rejects(importSession(f.source, f.stateDir, { fetchImpl: async () => { calls++; return json({}); } }), { code: 'SECRET_FILE_PERMISSIONS' });
  assert.equal(calls, 0); assert.equal(await fs.readFile(f.oldFile, 'utf8'), f.original);
}));
