import './isolate-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownItems } from '../scripts/lib/messages.mjs';
import { Client } from '../scripts/lib/client.mjs';
import { Transport, Pacer } from '../scripts/lib/transport.mjs';

globalThis.fetch = async () => { throw new Error('Live network prohibited in ownItems review'); };
const item = (id, { active = true } = {}) => ({ id, itemId: id, title: 'Test ' + id, price: { valueNotFormatted: 100 }, status: active ? 'active' : 'closed', statusId: active ? 4 : 11, url: '/moskva/test/card_' + id });
const page = (tab, number, items, total) => ({ userId: 'TEST_PROFILE', tabs: { currentTab: tab }, pager: { current: number }, items: { itemsList: items, totalCount: total } });
function clientFor(pages) {
  const calls = [];
  return { calls, session: { profile_id: 'TEST_PROFILE' }, identity: async () => ({ profile_id: 'TEST_PROFILE' }), rpc: async () => { throw Error('Chat-item RPC must not be used for owned listings'); }, transport: { request: async (url, options) => {
    assert.equal(url, '/web/1/serp/profile/items'); assert.equal(options.method, 'POST');
    calls.push(options.json.searchQuery);
    const response = pages[calls.length - 1];
    if (!response) throw Error('Unexpected extra request');
    return structuredClone(response);
  } } };
}

test('owned active items use profile SERP and cover all pages', async () => {
  const c = clientFor([page('active', 1, [item(1), item(2)], 3), page('active', 2, [item(3)], 3)]);
  const result = await ownItems(c);
  assert.equal(result.complete, true); assert.equal(result.pages, 2);
  assert.deepEqual(result.items.map(x => x.id), [1, 2, 3]);
  assert.deepEqual(c.calls, ['/profile/items/active/all?p=1', '/profile/items/active/all?p=2']);
});

test('profile SERP passes the real Transport allowlist with POST and private credentials stay local', async () => {
  const session = { profile_id: 'TEST_PROFILE', cookies: [] }, seen = [];
  const transport = new Transport(session, { pacer: new Pacer({ sleep: async () => {} }), fetchImpl: async (url, options) => {
    const pathname = new URL(url).pathname; seen.push([pathname, options.method]);
    const data = pathname === '/web/1/profiles/list' ? { result: { profiles: [{ profileId: 'TEST_PROFILE', isCurrent: true }] } } : page('active', 1, [item(1)], 1);
    return new Response(JSON.stringify(data), { status: 200 });
  } });
  const result = await ownItems(new Client(session, { transport }));
  assert.equal(result.complete, true); assert.equal(result.items.length, 1);
  assert.deepEqual(seen, [['/web/1/profiles/list', 'GET'], ['/web/1/serp/profile/items', 'POST']]);
});

test('all items combine active and old tabs with archive flags', async () => {
  const c = clientFor([page('active', 1, [item(1)], 1), page('old', 1, [item(2, { active: false })], 1)]);
  const result = await ownItems(c, { activeOnly: false });
  assert.equal(result.complete, true);
  assert.deepEqual(result.items.map(x => [x.id, x.isActive]), [[1, true], [2, false]]);
  assert.deepEqual(c.calls, ['/profile/items/active/all?p=1', '/profile/items/old/all?p=1']);
});

test('foreign profile is rejected even when item ids and pages look valid', async () => {
  const response = page('active', 1, [item(1)], 1); response.userId = 'OTHER_PROFILE';
  await assert.rejects(ownItems(clientFor([response])), { code: 'PROFILE_MISMATCH' });
});

test('wrong tab and wrong provider page are rejected', async () => {
  for (const response of [page('old', 1, [item(1)], 1), page('active', 2, [item(1)], 1)]) {
    await assert.rejects(ownItems(clientFor([response])), { code: 'OWN_ITEMS_SCHEMA_CHANGED' });
  }
});

test('changing total or repeated page never claims a complete listing', async () => {
  const changing = await ownItems(clientFor([page('active', 1, [item(1)], 3), page('active', 2, [item(2)], 4)]));
  assert.equal(changing.complete, false); assert.equal(changing.reason, 'LIST_CHANGED');
  const repeated = await ownItems(clientFor([page('active', 1, [item(1)], 3), page('active', 2, [item(1)], 3)]));
  assert.equal(repeated.complete, false); assert.equal(repeated.reason, 'CURSOR_STALLED');
});

test('page budget and early empty page retain an incomplete result', async () => {
  const budget = await ownItems(clientFor([page('active', 1, [item(1)], 2)]), { maxPages: 1 });
  assert.equal(budget.complete, false); assert.equal(budget.reason, 'PAGE_BUDGET');
  const empty = await ownItems(clientFor([page('active', 1, [item(1)], 2), page('active', 2, [], 2)]));
  assert.equal(empty.complete, false); assert.equal(empty.reason, 'CURSOR_STALLED');
});

test('genuinely empty own listing is complete', async () => {
  const result = await ownItems(clientFor([page('active', 1, [], 0)]));
  assert.equal(result.complete, true); assert.deepEqual(result.items, []);
});

test('invalid item URL and different id/itemId fail closed', async () => {
  const badUrl = item(1); badUrl.url = '/moskva/test/card_2';
  await assert.rejects(ownItems(clientFor([page('active', 1, [badUrl], 1)])), { code: 'ITEM_URL_MISMATCH' });
  const badId = item(1); badId.itemId = 2;
  await assert.rejects(ownItems(clientFor([page('active', 1, [badId], 1)])), { code: 'OWN_ITEMS_SCHEMA_CHANGED' });
});

test('invalid total cannot become a complete empty listing', async () => {
  await assert.rejects(ownItems(clientFor([page('active', 1, [], -1)])), { code: 'OWN_ITEMS_SCHEMA_CHANGED' });
});

test('missing statusId cannot silently erase an active result', async () => {
  const missing = item(1); delete missing.statusId;
  await assert.rejects(ownItems(clientFor([page('active', 1, [missing], 1)])), { code: 'OWN_ITEMS_SCHEMA_CHANGED' });
});
