# Исследованный контракт web API

Проверено 15 ноября 2026 UTC. Это набор операций данного скилла, не утверждение о полном API сайта. Origin всегда `https://www.avito.ru`. Авторизация — разрешённый cookie bundle владельца; браузерные antifraud проверки могут остановить доступ. Секреты и opaque context не включены в примеры.

## Чтение и поиск

| Метод и путь | Запрос | Используемый ответ |
|---|---|---|
| GET /web/1/profiles/list | limit=3, withEntities=true | result.profiles[]: profileId, isCurrent, name |
| GET /web/1/slocations | q, limit=10 | result.locations[]: id, names["1"], parent |
| GET /web/1/js/items | locationId, name, p; context из прошлого ответа | catalog.items[], searchCore, totalCount, itemsOnPage, context |
| GET canonical item URL | Без query/hash | buyerItem из JSON.parse-literal в __staticRouterHydrationData |
| POST /web/1/serp/profile/items | JSON {searchQuery:"/profile/items/active/all?p=1"}; tab old для архива | userId; items.itemsList[], totalCount; tabs.currentTab; pager.current/pages |

Search item: id, title, urlPath, locationId, priceDetailed.value, description. Buyer card: item.id/title/descriptionHtml/price/formattedPrice/isActive/userId, currentUserId, userHashedId, isMyItem. Для собственной карточки buyer hydration может отсутствовать: проверяется владелец и читается item-edit/load. Код не исполняет JavaScript страницы.

Own item: id=itemId, title, status, statusId, url, price.valueNotFormatted. `active`/4 — активное; `old`/11 — архив. JSON-RPC getItemsForFilter — только фильтр товаров мессенджера, не источник списка собственных объявлений.

## Категория и публикация

| Метод и путь | Запрос | Ответ/эффект |
|---|---|---|
| POST /item-add/load/v2 | {fromItemId:0, draftId?} | result.esid, item, params, user, geo defaults |
| POST /web/1/item-edit/navigation | {itemId:null} | result: дерево children, navigation.categoryId/attributes |
| POST /web/1/publish/categories/suggest/byTitle | {title,categoryId,publishSessionId} | result.categories[] |
| POST /web/2/item-edit/layout | {navigation,fieldsValues,publishSessionId,itemId?} | fields[] с name/id/widget/value/values/validation; steps |
| POST /web/2/item-edit/layout/filter | {fieldId,navigation,fieldsValues,query,offset,limit} | result.values или sections[].values, optionsTotal |
| POST /web/1/images/upload | multipart image, publishSessionId | id, url; upload — реальный побочный эффект |
| GET /web/3/location/suggest/by_query | query,categoryId | success.blocks[].list[]: title,subtitle,kind,jwt |
| GET /web/1/coords/by_address | address | point.latitude/longitude, kind, normalizedAddress |
| POST /js/v2/geo/position | categoryId,esid,params,latitude,longitude,address,zoom,isRadius,eventName | geoFieldsHash, locationId, parentLocationId, address, coords |
| POST /web/2/item/defaultContactMethod | categoryId,locationId | result.contactMethod.isAllowEmail/isHidePhone |
| POST /web/2/item/draft/save | URLencoded attributes[], state, deviceId, id/version при обновлении | result.draft.id/version; черновик |
| POST /web/4/fees/methods | categoryId,locationId,parentLocationId,params,itemFormParams,scenario:"publish" | status, applyFeesMode, singleFeePrice; только quote |
| POST /item-add/submit/v2 | multipart форма + draftId, publishSessionId, skipConfirm=1 | status; result.item.id; публичное объявление |

`skipConfirm=1` — настоящий commit, не dry-run. Переход /performance/{id} после submit — предложение продвижения; скрипт туда не идёт. Версия черновика не доказала CAS, поэтому локальная сериализация обязательна. Форму формируют скрипты из свежей схемы, точные ID enum не являются стабильным публичным контрактом.

Стандартные fields: title, description, price, images[], category_id, params[id], locationId, address, coords[lat/lng/zoom], geoFieldsHash, контактные поля, deliveryPvz=0, deliveryCnc=0. Только эти нули не гарантируют полного выключения доставки.

## Редактирование, доставка, архив

| Метод и путь | Запрос | Проверка |
|---|---|---|
| POST /item-edit/load/v2 | {itemId,fromItemId:0} | result.item.id/version, user.id, params, slots, coords |
| POST /web/4/fees/{id}/methods | текущая форма; scenario:"item-page", itemId | Нулевая плата; наблюдавшийся бесплатный edit mode="nothing" |
| POST /item-edit/submit/v2 | multipart свежая форма, itemId, version, publishSessionId, skipConfirm=1 | Повторный load; описание изменено, остальные значения сохранены |
| POST /web/1/delivery/conditions/{id}/seller | Без тела | services[]: type,enabled,available |
| POST /web/1/delivery/item/toggles/{id} | {option,enabled} | Повторное чтение всех services |
| GET /web/1/items/close-reasons | item_id[]=ID | buttons[]: reason,text,showInput,shouldUpdateIncome; items[] |
| POST /web/1/profile/items/close | {itemIds:[ID],reason:9} — ID причины получен из read | status=ok,result.closed; bodyItems.statusId=11 и isVisibleInSearch=false |

В текущем контракте `delivery`, `deliveryPostamat`, `deliveryCourier`, `deliveryCNC` поддержаны как toggles. Отсутствующий services или enabled неизвестного типа — ошибка. Пустой optional video после edit может нормализоваться из null в [""], это равнозначное отсутствие видео. Служебный params[198932] не является пользовательской характеристикой; остальные параметры сравниваются.

## JSON-RPC мессенджера

POST `/web/1/socket/fallback`: `{jsonrpc:"2.0",id,method,params}` → `{result}` или `{error}`.

| method | params | result |
|---|---|---|
| avito.getBodyItems.v3 | {ids:[ID]} | Массив type=item/value; originalUserId, statusId, urlPath, isActive? |
| avito.getChats.v5 | {limit,filters:{itemIds:[ID]},offsetTimestamp?} | channels[],hasMore; channelId,context.value.id,updated |
| avito.getChatById.v3 | {channelId} | channelId,context,readOnly,info |
| messenger.history.v2 | {channelId,limit,before?} | items[],count |
| avito.chatCreateByItemId.v2 | {itemId} | channelId |
| avito.sendTextMessage.v2 | {channelId,text,randomId} | id и другие поля сообщения; проверяется history |

Message: id,channelId,type,uid,originalUid,fromUid,created,body.text,body.randomId,delivered,read,isRead. `originalUid` обозначает профиль текущего viewer, не автора. Направление определяется fromUid относительно viewer hash/uid; системные сообщения отдельно. Timestamps — целые ticks (Unix ms ×10000), превышают безопасную точность JS Number; сохраняются строками, в запрос кодируются точным целым.

## Не включено

Нет endpoint для raw arbitrary request, заказа, оплаты, карты, баланса, покупки тарифа, paid promotion, subsidy или отправки физической посылки. `fees/methods` только проверяет стоимость. Любая неизвестная схема прекращает операцию с кодом, который можно воспроизвести тестом.
