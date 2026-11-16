import './isolate-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {authLogin} from '../scripts/lib/auth.mjs';
import {writeJson} from '../scripts/lib/storage.mjs';
import {AuthBrowser} from '../scripts/lib/auth-browser.mjs';
import {authAction} from '../scripts/lib/auth-observer.mjs';
import {AvitoError} from '../scripts/lib/errors.mjs';

const oldSession = {
  schema_version: 1, binding_id: 'review-fixture-binding', profile_id: '9',
  cookies: [{name: 'auth', value: 'SYNTHETIC_OLD', domain: '.avito.ru', path: '/', expires: -1}],
};
const candidateCookies = [{name: 'auth', value: 'SYNTHETIC_NEW', domain: '.avito.ru', path: '/', expires: -1}];
const identityResponse = () => new Response(JSON.stringify({status: 'ok', result: {
  profiles: [{profileId: 9, isCurrent: true, name: 'Review fixture'}],
}}));

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'avito-auth-review-'));
  await writeJson(path.join(dir, 'session.json'), oldSession);
  return dir;
}

function loginHarness(verificationEffect) {
  let time = 10000, phase = 0, uiInput, disconnected = false, uiClosed = false;
  const events = [];
  const browser = {
    contexts: new Map(),
    evaluate: async fn => fn.name === 'observeAuthDOM' ? {is_avito: true, stage: phase ? 'page' : 'credentials'} : undefined,
    identity: async () => phase ? {status: 200, profiles: [{id: '9', name: 'Review fixture', is_current: true}]} : {status: 401, profiles: []},
    cookies: async () => candidateCookies,
    disconnect: async () => { disconnected = true; },
  };
  const deps = {
    browserFactory: async () => browser,
    uiFactory: async input => {
      uiInput = input;
      return {url: 'http://127.0.0.1:1/', close: async () => { uiClosed = true; }};
    },
    now: () => time,
    sleep: async ms => { time += ms; if (ms === 1200) phase++; },
    emit: event => events.push(event),
    fetchImpl: async () => {
      await verificationEffect({cancel: () => uiInput.onAction({action: 'cancel'}), expire: () => { time += 60000; }});
      return identityResponse();
    },
  };
  return {deps, events, closed: () => disconnected && uiClosed};
}

for (const failure of ['cancel', 'expire']) {
  test(`${failure} while HTTP verification is pending preserves the previous session`, async () => {
    const dir = await fixture();
    try {
      const before = await fs.readFile(path.join(dir, 'session.json'));
      const h = loginHarness(async controls => { await controls[failure](); });
      await assert.rejects(authLogin(dir, {'force-login': 'true', 'timeout-seconds': '30'}, h.deps), {
        code: failure === 'cancel' ? 'AUTH_CANCELLED' : 'AUTH_TIMEOUT',
      });
      assert.deepEqual(await fs.readFile(path.join(dir, 'session.json')), before);
      assert.equal(h.events.some(e => e.stage === 'ready'), false);
      assert.equal(h.closed(), true);
      assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.tmp')), false);
    } finally { await fs.rm(dir, {recursive: true, force: true}); }
  });
}

test('video-transfer action targets the same Avito frame that supplied its observation', async () => {
  const dir = await fixture();
  try {
    let time = 10000, uiInput, actionCount = 0, actionContext;
    const frameId = 17;
    const browser = {
      contexts: new Map([[frameId, {id: frameId, origin: 'https://id.avito.ru', auxData: {isDefault: true}}]]),
      evaluate: async (fn, args, contextId) => {
        if (fn.name === 'observeAuthDOM') return contextId === frameId
          ? {is_avito: true, stage: 'video', consent_required: false, has_transfer: true, verification_urls: [], video_step: 1}
          : {is_avito: true, stage: 'page'};
        if (fn.name === 'authAction') { actionCount++; actionContext = contextId; return {clicked: true}; }
      },
      identity: async () => ({status: 401, profiles: []}),
      disconnect: async () => {},
    };
    await assert.rejects(authLogin(dir, {'force-login': 'true', 'timeout-seconds': '30'}, {
      browserFactory: async () => browser,
      uiFactory: async input => { uiInput = input; return {url: 'http://127.0.0.1:1/', close: async () => {}}; },
      now: () => time,
      sleep: async ms => { time += ms; if (ms === 1200) await uiInput.onAction({action: 'cancel'}); },
      fetchImpl: async () => { throw new Error('No HTTP session verification is permitted in this fixture'); },
    }), {code: 'AUTH_CANCELLED'});
    assert.equal(actionCount, 1);
    assert.equal(actionContext, frameId, 'The action must use the observed frame rather than the main document');
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});

test('reusing an already authenticated browser does not claim a fresh login was observed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'avito-auth-review-reuse-'));
  try {
    let time = 10000;
    const browser = {
      contexts: new Map(),
      evaluate: async fn => fn.name === 'observeAuthDOM' ? {is_avito: true, stage: 'page'} : undefined,
      identity: async () => ({status: 200, profiles: [{id: '9', name: 'Review fixture', is_current: true}]}),
      cookies: async () => candidateCookies,
      disconnect: async () => {},
    };
    const result = await authLogin(dir, {'timeout-seconds': '30'}, {
      browserFactory: async () => browser,
      uiFactory: async () => ({url: 'http://127.0.0.1:1/', close: async () => {}}),
      now: () => time,
      sleep: async ms => { time += ms; },
      fetchImpl: async () => identityResponse(),
    });
    assert.equal(result.verified, true);
    assert.equal(result.fresh_login_observed, false);
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});

test('cookie collection is scoped to Avito before data leaves the selected browser target', async () => {
  const calls = [];
  const cdp = {
    listeners: new Set(),
    send: async (method, params, sessionId) => { calls.push({method, params, sessionId}); return {cookies: candidateCookies}; },
  };
  const browser = new AuthBrowser(cdp, 'selected-session', 'selected-target', false);
  browser.browserContextId = 'selected-context';
  await browser.cookies();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'Network.getCookies', 'Storage.getCookies retrieves unrelated credential cookies before filtering');
  assert.equal(calls[0].sessionId, 'selected-session');
  assert.ok(calls[0].params.urls.length > 0);
  assert.ok(calls[0].params.urls.every(url => new URL(url).origin === 'https://www.avito.ru'));
});

test('a detached selected target fails promptly while the browser connection remains open', async () => {
  const cdp = {
    listeners: new Set(),
    send: async () => { throw new AvitoError('BROWSER_COMMAND_FAILED'); },
  };
  const browser = new AuthBrowser(cdp, 'selected-session', 'selected-target', false);
  for (const listener of cdp.listeners) listener({
    method: 'Target.detachedFromTarget',
    params: {sessionId: 'selected-session', targetId: 'selected-target'},
  });
  await assert.rejects(browser.evaluate(() => 1), error =>
    ['BROWSER_DISCONNECTED', 'BROWSER_PAGE_CLOSED'].includes(error.code));
});

for (const origin of ['https://www.avito.ru', 'https://elsewhere.invalid']) {
  test(`an old video observation cannot click a non-auth Continue button at ${origin}`, () => {
    let clicked = false;
    const button = {
      textContent: 'Продолжить', innerText: 'Продолжить', disabled: false,
      getClientRects: () => [{}], click: () => { clicked = true; },
    };
    const root = {
      innerText: 'Редактирование объявления',
      querySelectorAll: selector => /button/.test(selector) ? [button] : [],
    };
    const context = {
      location: {origin},
      document: {body: root, querySelectorAll: () => []},
    };
    vm.runInNewContext(`(${authAction.toString()})('video-next')`, context);
    assert.equal(clicked, false, 'A stale observation must not authorize a button in the current non-auth page');
  });
}

for (const kind of ['video-next', 'open-login']) {
  test(`${kind} never clicks a matching control after navigation outside Avito`, () => {
    let clicked = false;
    const label = kind === 'open-login' ? 'Вход и регистрация' : 'Продолжить';
    const button = {
      textContent: label, innerText: label, disabled: false,
      getClientRects: () => [{}], click: () => { clicked = true; },
    };
    const root = {
      innerText: 'Подтвердите личность. Видеопроверка',
      querySelectorAll: selector => /button/.test(selector) ? [button] : [],
    };
    vm.runInNewContext(`(${authAction.toString()})(${JSON.stringify(kind)})`, {
      location: {origin: 'https://elsewhere.invalid'},
      document: {body: root, querySelectorAll: () => []},
    });
    assert.equal(clicked, false);
  });
}
