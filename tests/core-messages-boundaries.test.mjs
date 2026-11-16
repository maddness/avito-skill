import {fileURLToPath} from 'node:url';
import './isolate-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareMessage, sendMessage } from '../scripts/lib/messages.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
async function fixture(run) {
  const dir = await fs.mkdtemp(path.join(root, 'recipient-fixture-'));
  const mock = { profile: 'TEST_PROFILE', chatItem: 123, mine: false, writes: [] };
  const client = {
    session: { profile_id: 'TEST_PROFILE' },
    identity: async () => ({ profile_id: 'TEST_PROFILE' }),
    bodyItems: async () => [{ id: 123, urlPath: '/moskva/test/card_123' }],
    transport: { request: async () => {
      const card = { item: { id: 123, title: 'Test', userId: 7, isActive: true }, currentUserId: mock.profile, userHashedId: 'TEST_VIEWER', isMyItem: mock.mine };
      return '<script>window.__staticRouterHydrationData = JSON.parse(' + JSON.stringify(JSON.stringify({ loaderData: { route: { buyerItem: card } } })) + ');</script>';
    } },
    rpc: async (method, params, options) => {
      if (options?.write) mock.writes.push({ method, params });
      if (method === 'avito.getChatById.v3') return { channelId: params.channelId, context: { value: { id: mock.chatItem } } };
      throw new Error('Unexpected mock method: ' + method);
    },
  };
  try { return await run({ dir, client, mock }); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('prepare rejects a chat whose item differs from explicitly requested item', () => fixture(async ({ dir, client, mock }) => {
  mock.chatItem = 999;
  await assert.rejects(prepareMessage(client, dir, { itemId: '123', chatId: 'TEST_CHAT', text: 'Test', intent: 'boundary-fixture' }), { code: 'ITEM_ATTRIBUTION_MISMATCH' });
  assert.equal(mock.writes.length, 0);
}));

test('send checks thread item again before any message write', () => fixture(async ({ dir, client, mock }) => {
  const prepared = await prepareMessage(client, dir, { itemId: '123', chatId: 'TEST_CHAT', text: 'Test', intent: 'boundary-fixture' });
  mock.chatItem = 999;
  await assert.rejects(sendMessage(client, dir, prepared.operation_id), { code: 'CHAT_SCOPE_MISMATCH' });
  assert.equal(mock.writes.length, 0);
}));

test('send checks the fresh card viewer before any message write', () => fixture(async ({ dir, client, mock }) => {
  const prepared = await prepareMessage(client, dir, { itemId: '123', chatId: 'TEST_CHAT', text: 'Test', intent: 'boundary-fixture' });
  mock.profile = 'OTHER_TEST_PROFILE';
  await assert.rejects(sendMessage(client, dir, prepared.operation_id), { code: 'PROFILE_MISMATCH' });
  assert.equal(mock.writes.length, 0);
}));

test('two seller conversations on the same owned listing remain separate targets', () => fixture(async ({ dir, client, mock }) => {
  mock.mine = true;
  const a = await prepareMessage(client, dir, { itemId: '123', chatId: 'TEST_CHAT_A', text: 'Test', intent: 'ONE_REPLY_BATCH' });
  const b = await prepareMessage(client, dir, { itemId: '123', chatId: 'TEST_CHAT_B', text: 'Test', intent: 'ONE_REPLY_BATCH' });
  assert.notEqual(a.operation_id, b.operation_id);
  assert.equal(mock.writes.length, 0);
}));
