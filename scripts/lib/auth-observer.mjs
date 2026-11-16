// Closed observations only. Input values, page text, screenshots and network bodies
// never leave the browser except the narrowly selected official verification URL.
export function observeAuthDOM(){
 const visible=e=>!!e?.getClientRects().length;
 const root=[...document.querySelectorAll('[role="dialog"]')].filter(visible).at(-1)||document.body;
 const text=root?.innerText||'';
 const captcha=[...document.querySelectorAll('iframe')].some(e=>visible(e)&&/captcha|geetest|arkose/i.test(e.src))||/выберите.{0,50}(изображ|картин)|подтвердите.{0,20}(не робот)|введите.{0,20}(картинк)/i.test(text);
 const video=/провер[а-яё\s]{0,30}видео|видеопровер|провер[а-яё\s]{0,20}по видео|подтверд[а-яё\s]{0,30}личност/i.test(text);
 const sms=[...root.querySelectorAll('input')].some(e=>visible(e)&&e.autocomplete==='one-time-code')||/введите.{0,30}код.{0,30}(смс|sms|телефон)|код (из|отправлен).{0,30}(смс|sms|телефон)/i.test(text);
 const password=[...root.querySelectorAll('input[type="password"]')].some(visible);
 const consent=[...root.querySelectorAll('input[type="checkbox"]')].some(e=>visible(e)&&!e.checked);
 const controls=[...root.querySelectorAll('a,button,[role="button"]')].filter(visible);
 const transfer=controls.some(e=>/друг[а-яё]* устройств|телефон|скопировать ссылку|копировать ссылку/i.test(e.textContent||''));
 const urls=[];
 if(video){for(const e of [...root.querySelectorAll('a[href],input:not([type="password"]):not([type="hidden"]),textarea')].filter(visible)){
  const label=(e.textContent||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.getAttribute('placeholder')||'');
  const raw=e.tagName==='A'?e.href:e.value;
  if(!raw||e.tagName==='A'&&!/провер|видео|друг|телефон|ссылк/i.test(label))continue;
  try{const u=new URL(raw);if(u.protocol==='https:'&&(u.hostname==='avito.ru'||u.hostname.endsWith('.avito.ru'))&&!u.username&&!u.password&&!/^(\/(?:|privacy|safety|legal|login))\/?$/.test(u.pathname))urls.push(u.href);}catch{}
 }}
 const labels=[...root.querySelectorAll('h1,h2,h3,button,[role="button"]')].filter(visible).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).join('|');let signature=0;if(video)for(const c of labels)signature=(Math.imul(signature,31)+c.charCodeAt(0))|0;
 return {video_step:video?signature:null,is_avito:location.origin==='https://www.avito.ru'||/^https:\/\/[a-z0-9.-]+\.avito\.ru$/.test(location.origin),stage:captcha?'captcha':sms?'sms':video?'video':password?'credentials':'page',consent_required:video&&consent,has_transfer:video&&transfer,verification_urls:[...new Set(urls)]};
}
export function authAction(kind,expectedStep){
 if(location.origin!=='https://www.avito.ru'&&!/^https:\/\/[a-z0-9.-]+\.avito\.ru$/.test(location.origin))return {clicked:false};
 const visible=e=>!!e?.getClientRects().length;const root=[...document.querySelectorAll('[role="dialog"]')].filter(visible).at(-1)||document.body;
 const controls=[...root.querySelectorAll('button,a,[role="button"]')].filter(e=>visible(e)&&!e.disabled);
 const expression=kind==='open-login'?/^Вход и регистрация$/:kind==='video-transfer'?/^(?:Пройти |Продолжить |Проверка )?(?:на другом устройстве|на телефоне|Скопировать ссылку|Копировать ссылку)$/i:/^(?:Далее|Продолжить|К проверке)$/;
 if(kind!=='open-login'&&!/провер[а-яё\s]{0,30}видео|видеопровер|провер[а-яё\s]{0,20}по видео|подтверд[а-яё\s]{0,30}личност/i.test(root.innerText||''))return {clicked:false};
 if(kind!=='open-login'&&expectedStep!==undefined&&expectedStep!==null){const labels=[...root.querySelectorAll('h1,h2,h3,button,[role="button"]')].filter(visible).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim()).join('|');let signature=0;for(const c of labels)signature=(Math.imul(signature,31)+c.charCodeAt(0))|0;if(signature!==expectedStep)return {clicked:false};}
 const matches=controls.filter(e=>expression.test((e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()));if(matches.length!==1)return {clicked:false};
 if(kind!=='open-login'&&[...root.querySelectorAll('input[type="checkbox"]')].some(e=>visible(e)&&!e.checked))return {clicked:false,consent_required:true};
 matches[0].click();return {clicked:true};
}
export function installLinkCapture(){
 if(window.__avitoLinkCaptureInstalled)return;window.__avitoLinkCaptureInstalled=true;let actionUntil=0;
 document.addEventListener('click',e=>{const b=e.target.closest?.('button,a,[role="button"]');if(b&&/^(?:Скопировать|Копировать) ссылку$/i.test((b.innerText||b.textContent||'').trim()))actionUntil=Date.now()+2500;},true);
 const original=navigator.clipboard?.writeText?.bind(navigator.clipboard);if(!original)return;
 try{navigator.clipboard.writeText=function(text){if(Date.now()<actionUntil){try{const u=new URL(text);if(u.protocol==='https:'&&(u.hostname==='avito.ru'||u.hostname.endsWith('.avito.ru'))&&!u.username&&!u.password)window.__avitoAuthLink(JSON.stringify({url:u.href}));}catch{}}return original(text);};}catch{}
}
export function validateVerificationURL(value){if(typeof value!=='string'||value.length>8192)return null;try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!(u.hostname==='avito.ru'||u.hostname.endsWith('.avito.ru')))return null;if((u.pathname==='/'&&!u.search)||/^\/(?:privacy|legal|safety)(?:\/|$)/.test(u.pathname))return null;return u.href;}catch{return null;}}
