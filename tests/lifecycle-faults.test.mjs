import {fileURLToPath} from 'node:url';
import './isolate-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareEdit, applyEdit, verifyEditOperation, withdraw, verifyWithdrawOperation } from '../scripts/lib/lifecycle.mjs';
import { readJson } from '../scripts/lib/storage.mjs';
import { AvitoError } from '../scripts/lib/errors.mjs';

globalThis.fetch = async () => { throw new Error('Live network prohibited in lifecycle review'); };
const root = path.dirname(fileURLToPath(import.meta.url));
async function fixture(callback) {
  const dir = await fs.mkdtemp(path.join(root, 'lifecycle-fixture-'));
  const d = { item: { id: 123, version: 1, title: 'Test', description: 'Old', price: 1000, category: { id: 10 }, location: { id: 1, parentId: 100 }, images: [{ id: 'TEST_IMAGE' }], email: '', sellerName: 'Test Seller' }, params: [{ id: 2880, selected: 'Москва, улица Лесная' }], coords: { lat: 55, lng: 37, zoom: 16 }, slots: [{ value: { contactMethod: 'any', phone: 'TEST_PHONE', stockMultiple: false, autoPublish: false } }], geoFieldsHash: 'TEST_HASH', esid: 'TEST_SESSION' };
  const state = { editCalls: 0, closeCalls: 0, editResponseLost: false, closeResponseLost: false, active: true, fee: 0 };
  const client = {
    session: { profile_id: 'TEST_PROFILE' },
    editBootstrap: async () => structuredClone(d),
    ownItem: async () => ({ id: 123, isActive: state.active, statusId: state.active ? 4 : 11, isVisibleInSearch: state.active }),
    navigation: async () => ({ id: 'CAT', title: 'Стулья', navigation: { categoryId: 10, attributes: [] }, children: [] }),
    delivery: async () => ({ services: [{ type: 'delivery', enabled: false }] }),
    transport: { request: async (url, options) => {
      if (url === '/web/2/item-edit/layout') return { fields: [{ id: 100001, name: 'title' }, { id: 100002, name: 'description' }, { id: 100003, name: 'price' }, { id: 2880, name: 'params[2880]' }] };
      if (url === '/web/4/fees/123/methods') return { status: 'ok', applyFeesMode: state.fee ? 'full' : 'free', singleFeePrice: state.fee };
      if (url === '/item-edit/submit/v2') {
        state.editCalls++; d.item.description = options.form.get('description'); d.item.version++;
        if (state.editResponseLost) throw new AvitoError('NETWORK_ERROR', { outcome_unknown: true });
        return { status: 'ok' };
      }
      if (url.includes('/web/1/items/close-reasons')) return { buttons: [{ reason: 'TEST_OTHER', text: 'Другая причина', shouldUpdateIncome: false, showInput: false }], items: [{ item_id: 123 }] };
      if (url === '/web/1/profile/items/close') {
        state.closeCalls++; state.active = false;
        if (state.closeResponseLost) throw new AvitoError('NETWORK_ERROR', { outcome_unknown: true });
        return { status: 'ok' };
      }
      throw Error('Unexpected mock route: ' + url);
    } },
  };
  try { await callback({ dir, client, state, d }); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('description-only edit preserves other fixture fields and repeats without submit', () => fixture(async f => {
  const prepared = await prepareEdit(f.client, f.dir, { id: '123', description: 'New', intent: 'EDIT_ONE' });
  const result = await applyEdit(f.client, f.dir, prepared.operation_id);
  assert.equal(result.verified, true); assert.equal(f.d.item.description, 'New');
  await applyEdit(f.client, f.dir, prepared.operation_id);
  assert.equal(f.state.editCalls, 1);
}));

test('edit response lost after acceptance can be verified without repeated submit', () => fixture(async f => {
  const prepared = await prepareEdit(f.client, f.dir, { id: '123', description: 'New', intent: 'EDIT_ONE' });
  f.state.editResponseLost = true;
  await assert.rejects(applyEdit(f.client, f.dir, prepared.operation_id), { code: 'NETWORK_ERROR' });
  await assert.rejects(applyEdit(f.client, f.dir, prepared.operation_id), { code: 'RECONCILE_REQUIRED' });
  const recovered = await verifyEditOperation(f.client, f.dir, prepared.operation_id);
  assert.equal(recovered.status, 'succeeded'); assert.equal(f.state.editCalls, 1);
}));

test('new positive edit fee blocks apply before submit', () => fixture(async f => {
  const prepared = await prepareEdit(f.client, f.dir, { id: '123', description: 'New', intent: 'EDIT_ONE' });
  f.state.fee = 100;
  await assert.rejects(applyEdit(f.client, f.dir, prepared.operation_id), { code: 'FREE_PUBLICATION_REQUIRED' });
  assert.equal(f.state.editCalls, 0);
}));

test('withdraw response lost after acceptance is reconciled without a second close', () => fixture(async f => {
  f.state.closeResponseLost = true;
  await assert.rejects(withdraw(f.client, f.dir, { id: '123', intent: 'WITHDRAW_ONE' }), { code: 'NETWORK_ERROR' });
  const index = await readJson(path.join(f.dir, 'operations', 'index.json'));
  const opId = Object.values(index.by_key)[0];
  const recovered = await verifyWithdrawOperation(f.client, f.dir, opId);
  assert.equal(recovered.status, 'succeeded'); assert.equal(f.state.active, false); assert.equal(f.state.closeCalls, 1);
}));
