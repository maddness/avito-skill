import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AvitoError } from '../scripts/lib/errors.mjs';

globalThis.fetch = async () => { throw new Error('Live network prohibited in publisher review'); };
const root = path.dirname(fileURLToPath(import.meta.url));
const clone = value => structuredClone(value);

export async function fixture() {
  const dir = await fs.mkdtemp(path.join(root, 'publisher-fixture-'));
  const photos = [path.join(dir, 'photo-a.jpg'), path.join(dir, 'photo-b.jpg')];
  await fs.writeFile(photos[0], Buffer.from([255, 216, 1, 2, 3]));
  await fs.writeFile(photos[1], Buffer.from([255, 216, 4, 5, 6]));
  const spec = { title: 'Тестовый стул', description: 'Описание тестового стула', price_rub: 1000, condition: 'used', photos, category_choice: 'TEST_CATEGORY', location: { query: 'Москва, улица Лесная', precision: 'street' }, delivery: { enabled: false } };
  const base = { esid: 'TEST_PUBLISH_SESSION', item: { email: '', sellerName: 'Test Seller', phone: 'TEST_PHONE' }, user: { id: 'TEST_PROFILE', name: 'Test Seller' } };
  const fields = [
    { id: 100001, name: 'title', label: 'Название' },
    { id: 100002, name: 'description', label: 'Описание' },
    { id: 100003, name: 'price', label: 'Цена' },
    { id: 100004, name: 'images', label: 'Фото', widget: { type: 'uploader', config: { max: 10 } } },
    { id: 100006, name: 'locationId', label: 'Город', widget: { type: 'locationId' } },
    { id: 100010, name: 'params[100010]', label: 'Адрес', widget: { type: 'address' } },
  ];
  const state = { drafts: new Map(), items: new Map(), uploaded: 0, savedDrafts: 0, submissions: 0, feeCalls: 0, deliveryWrites: 0, feesReply: { status: 'ok', applyFeesMode: 'free' }, services: [{ type: 'delivery', enabled: true, available: true }, { type: 'deliveryCourier', enabled: false, available: true }], city: 'Москва', street: 'улица Лесная', geoAddress: null, submitError: null, postcheckError: null, ownerFallback: false };
  const client = {
    session: { profile_id: 'TEST_PROFILE' },
    identity: async () => ({ profile_id: 'TEST_PROFILE' }),
    navigation: async () => ({ id: 'TEST_CATEGORY', title: 'Стулья', navigation: { categoryId: 10, attributes: [] }, children: [] }),
    layout: async () => ({ fields: clone(fields) }),
    bootstrap: async id => id ? { ...clone(base), item: clone(state.drafts.get(String(id))) } : clone(base),
    upload: async () => ({ id: 'TEST_IMAGE_' + (++state.uploaded) }),
    geo: async input => ({ ...input, address: state.geoAddress ?? [state.city, state.street].join(', '), latitude: 55, longitude: 37, zoom: 16, geoFieldsHash: 'TEST_GEO_HASH', locationId: state.city === 'Москва' ? 1 : 2, parentLocationId: 100 }),
    saveDraft: async input => {
      const attrs = Object.fromEntries(input.attributes.map(x => [x.id, x.value]));
      const id = String(input.id ?? ++state.savedDrafts);
      const item = { ...clone(base.item), id, title: attrs[100001], description: attrs[100002], price: attrs[100003], images: attrs[100004].map(id => ({ id })) };
      state.drafts.set(id, item);
      return { draft: { id, version: 1 } };
    },
    contact: async () => ({ isAllowEmail: true, isHidePhone: true }),
    fees: async () => {
      state.feeCalls++;
      return typeof state.feesReply === 'function' ? state.feesReply(state.feeCalls) : clone(state.feesReply);
    },
    ownItem: async id => {
      const item = state.items.get(String(id));
      if (!item) throw new AvitoError('ITEM_NOT_FOUND');
      return { ...clone(item), originalUserId: 'TEST_PROFILE', isActive: true, urlPath: '/moskva/test/item_' + id };
    },
    bodyItems: async ids => Promise.all(ids.map(id => client.ownItem(id))),
    editBootstrap: async id => ({ user: { id: 'TEST_PROFILE' }, item: { ...clone(state.items.get(String(id))), category: { id: 10 }, location: { id: 1 } } }),
    delivery: async () => ({ services: clone(state.services) }),
    setDelivery: async (id, type, enabled) => { state.services.find(x => x.type === type).enabled = enabled; state.deliveryWrites++; return { status: 'ok' }; },
    transport: { request: async (url, options = {}) => {
      const u = new URL(url, 'https://www.avito.ru');
      if (u.pathname === '/web/3/location/suggest/by_query') return { success: { blocks: [{ list: [{ title: state.street, subtitle: state.city, kind: 'street', coordinates: { latitude: 55, longitude: 37 } }] }] } };
      if (u.pathname === '/item-add/submit/v2') {
        state.submissions++;
        const id = String(122 + state.submissions), form = options.form;
        const item = { id, title: form.get('title'), description: form.get('description'), price: Number(form.get('price')), images: form.getAll('images[]').map(id => ({ id })), isActive: true, userId: 'TEST_PROFILE' };
        state.items.set(id, item);
        if (state.submitError) throw state.submitError;
        return { status: 'ok', result: { item: { id } } };
      }
      const id = u.pathname.match(/_([0-9]+)$/)?.[1];
      if (id) {
        if (state.postcheckError) throw state.postcheckError;
        const hydration = { loaderData: { route: state.ownerFallback ? {} : { buyerItem: { item: clone(state.items.get(id)), currentUserId: 'TEST_PROFILE', isMyItem: true } } } };
        return '<script>window.__staticRouterHydrationData = JSON.parse(' + JSON.stringify(JSON.stringify(hydration)) + ');</script>';
      }
      throw new Error('Unexpected offline route: ' + u.pathname);
    } },
  };
  return { dir, client, spec, state, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}
