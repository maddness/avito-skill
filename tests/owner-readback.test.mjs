import './isolate-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '../scripts/lib/client.mjs';

test('owner fallback does not read edit bootstrap for someone else\'s item', async () => {
  let editCalls = 0;
  const client = new Client({ profile_id: 'TEST_PROFILE' }, { transport: { request: async (url, options) => {
    if (url.startsWith('/web/1/profiles/list')) return { result: { profiles: [{ isCurrent: true, profileId: 'TEST_PROFILE' }] } };
    if (url === '/web/1/socket/fallback') return { result: [{ type: 'item', value: { id: 123, originalUserId: 'OTHER_PROFILE' } }] };
    editCalls++; throw Error('Unexpected edit request');
  } } });
  await assert.rejects(client.editBootstrap(123), { code: 'ITEM_OWNER_MISMATCH' });
  assert.equal(editCalls, 0);
});

test('owner fallback validates both item id and returned profile', async () => {
  for (const returned of [{ item: { id: 999 }, user: { id: 'TEST_PROFILE' } }, { item: { id: 123 }, user: { id: 'OTHER_PROFILE' } }]) {
    const client = new Client({ profile_id: 'TEST_PROFILE' }, { transport: { request: async url => {
      if (url.startsWith('/web/1/profiles/list')) return { result: { profiles: [{ isCurrent: true, profileId: 'TEST_PROFILE' }] } };
      if (url === '/web/1/socket/fallback') return { result: [{ type: 'item', value: { id: 123, originalUserId: 'TEST_PROFILE' } }] };
      if (url === '/item-edit/load/v2') return { result: returned };
      throw Error('Unexpected route');
    } } });
    await assert.rejects(client.editBootstrap(123), { code: 'ITEM_OWNER_MISMATCH' });
  }
});
