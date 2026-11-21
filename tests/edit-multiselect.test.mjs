import test from 'node:test';
import assert from 'node:assert/strict';
import { editFields } from '../scripts/lib/lifecycle.mjs';
import { plainText } from '../scripts/lib/search.mjs';

const d = {
  item: { id: 1, version: 2, title: 'Test', description: 'Old', price: 100, category: { id: 29 }, location: { id: 639300 }, images: [{ id: '1' }], email: 'test@example.com', sellerName: 'Seller' },
  params: [{ id: 168317, selected: [3273290] }, { id: 165436, selected: [3265830, 3265831] }, { id: 2880, selected: 'Реутов' }],
  coords: { lat: 1, lng: 2, zoom: 3 },
  slots: [{ value: { contactMethod: 'messenger', phone: '+7 900 000-00-00', stockMultiple: false, autoPublish: false } }],
  geoFieldsHash: 'TEST_HASH',
  esid: 'TEST_SESSION'
};
const layout = {
  fields: [
    { id: 168317, name: 'params[168317][][]' },
    { id: 165436, name: 'params[165436][][]' },
    { id: 2880, name: 'params[2880]' },
    { id: 100001, name: 'title' },
    { id: 100002, name: 'description' },
    { id: 100003, name: 'price' },
    { id: 100006, name: 'locationId' }
  ]
};

test('multi-select params keep every value under the layout field name', () => {
  const form = editFields(d, layout, 'New');
  assert.deepEqual(form.filter(([k]) => k === 'params[165436][][]'), [['params[165436][][]', '3265830'], ['params[165436][][]', '3265831']]);
  assert.deepEqual(form.filter(([k]) => k === 'params[168317][][]'), [['params[168317][][]', '3273290']]);
  assert.deepEqual(form.filter(([k]) => k === 'description'), [['description', 'New']]);
});

test('messenger contact mode round-trips through hidePhone', () => {
  assert.deepEqual(editFields(d, layout, 'New').filter(([k]) => k === 'hidePhone'), [['hidePhone', '1']]);
  const any = { ...d, slots: [{ value: { ...d.slots[0].value, contactMethod: 'any' } }] };
  assert.deepEqual(editFields(any, layout, 'New').filter(([k]) => k === 'hidePhone'), [['hidePhone', '']]);
});

test('plainText normalizes CRLF line endings', () => {
  assert.equal(plainText('a\r\nb\rc'), 'a\nb\nc');
});
