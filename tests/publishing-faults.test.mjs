import './isolate-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSale, publishSale, verifySale } from '../scripts/lib/publishing.mjs';
import { Operations } from '../scripts/lib/operations.mjs';
import { AvitoError } from '../scripts/lib/errors.mjs';
import { fixture } from './publishing-fixture.mjs';

async function run(callback) { const f = await fixture(); try { await callback(f); } finally { await f.cleanup(); } }

test('successful publication is repeated without a second submit and disables delivery', () => run(async f => {
  const prepared = await prepareSale(f.client, f.dir, f.spec);
  const first = await publishSale(f.client, f.dir, prepared.operation_id);
  const second = await publishSale(f.client, f.dir, prepared.operation_id);
  assert.equal(first.item_id, '123'); assert.deepEqual(first.delivery, []);
  assert.equal(second.already_completed, true); assert.equal(f.state.submissions, 1);
  assert.equal(f.state.services.some(x => x.enabled), false);
}));

test('positive fee on final preflight prevents submit after a previously free preparation', () => run(async f => {
  const prepared = await prepareSale(f.client, f.dir, f.spec);
  f.state.feesReply = { status: 'ok', applyFeesMode: 'full', singleFeePrice: 100 };
  await assert.rejects(publishSale(f.client, f.dir, prepared.operation_id), { code: 'FREE_PUBLICATION_REQUIRED' });
  assert.equal(f.state.submissions, 0);
  assert.equal((await new Operations(f.dir, 'TEST_PROFILE').get(prepared.operation_id)).status, 'prepared');
}));

test('response lost after server acceptance keeps unknown and never resubmits', () => run(async f => {
  const prepared = await prepareSale(f.client, f.dir, f.spec);
  f.state.submitError = new AvitoError('NETWORK_ERROR', { outcome_unknown: true });
  await assert.rejects(publishSale(f.client, f.dir, prepared.operation_id), { code: 'NETWORK_ERROR' });
  await assert.rejects(publishSale(f.client, f.dir, prepared.operation_id), { code: 'RECONCILE_REQUIRED' });
  await assert.rejects(verifySale(f.client, f.dir, prepared.operation_id), { code: 'PUBLICATION_ID_UNKNOWN' });
  assert.equal(f.state.submissions, 1); assert.equal(f.state.items.size, 1);
  assert.equal((await new Operations(f.dir, 'TEST_PROFILE').get(prepared.operation_id)).status, 'unknown');
}));

test('known item survives failed postcheck and verify recovers without submit', () => run(async f => {
  const prepared = await prepareSale(f.client, f.dir, f.spec);
  f.state.postcheckError = new AvitoError('CARD_SCHEMA_CHANGED');
  await assert.rejects(publishSale(f.client, f.dir, prepared.operation_id), { code: 'CARD_SCHEMA_CHANGED' });
  const op = await new Operations(f.dir, 'TEST_PROFILE').get(prepared.operation_id);
  assert.equal(op.observation.item_id, '123'); assert.equal(op.status, 'unknown');
  f.state.postcheckError = null;
  f.state.ownerFallback = true;
  const recovered = await verifySale(f.client, f.dir, prepared.operation_id);
  assert.equal(recovered.status, 'succeeded'); assert.equal(recovered.result.item_id, '123');
  assert.deepEqual(recovered.result.delivery, []); assert.equal(f.state.submissions, 1);
}));
