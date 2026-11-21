/* =====================================================================
   schedule-cal — подписка на расписание в календаре телефона (.ics)
   Cloudflare Worker. Как установить — см. worker/README.md.

   Адреса:
     /cal/<группа>.ics?настройки  — сам календарь (на него подписывается телефон)
     /sub/<группа>?настройки      — страница «Подписаться» (iPhone / Android)
   Настройки (все необязательные):
     f   = s (АХД · Лекция, по умолчанию) | f (полное название) | c (только АХД)
     e   = 1 — эмодзи типов пар
     kch = 0 — скрыть кураторский час
     fk  = 0 — скрыть физкультуру
     cnl = 0 — скрыть отменённые пары (по умолчанию они видны как «❌ ОТМЕНА»)
     a   = 5|10|15|30|60 — напоминание за N минут (работает на iPhone)
   Плюс: ежедневное сообщение от бота в 20:00 — раздел «Ежедневное сообщение» ниже.
   ===================================================================== */

const SITE = 'https://yotonick.github.io/aupprbbot/';   // откуда брать расписание (наружу не показывается)
const APP_LINK = 'https://t.me/auschedulebot';          // ссылка на мини-апп в Telegram
const CAL_COLOR = '#4F5BFF';
const DATA_TTL = 60 * 1000;                              // как часто перечитывать данные с сайта
const TZ_OFFSET = 3;                                     // Минск: UTC+3 круглый год

/* ---------------- данные ---------------- */
let memo = null; // { at, data, notices } — последняя удачная загрузка (живёт, пока жив воркер)

async function getJSON(url, allow404) {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { headers: { 'user-agent': 'schedule-cal' } });
  if (allow404 && r.status === 404) return null;
  if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
  return r.json();
}
const okData = (d) => d && d.v === 1 && Array.isArray(d.groups) && d.groups.length && d.lessons && d.subjects &&
  Object.values(d.lessons).some((l) => Array.isArray(l) && l.length);
const okNotices = (n) => n && n.v === 1 && Array.isArray(n.notices) && (!n.changes || Array.isArray(n.changes));

async function load() {
  if (memo && Date.now() - memo.at < DATA_TTL) return memo;
  try {
    const [data, notices] = await Promise.all([getJSON(SITE + 'schedule-full.json'), getJSON(SITE + 'notices.json', true)]);
    if (!okData(data)) throw new Error('schedule-full.json пустой или повреждён');
    const n = notices === null ? { v: 1, notices: [], changes: [] } : notices;
    if (!okNotices(n)) throw new Error('notices.json повреждён');
    memo = { at: Date.now(), data, notices: n };
  } catch (e) {
    /* сайт недоступен или файл битый: отдаём последнюю удачную копию.
       Если её нет — ошибка 503: телефон тогда просто оставит старый календарь,
       а не сотрёт все пары (пустой календарь отдавать нельзя ни в коем случае). */
    if (!memo) throw e;
  }
  return memo;
}

/* ---------------- логика расписания (как в schedule.html) ---------------- */
const TYPES = { 'л': ['Лекция', 'lec'], 'пз': ['Практика', 'pr'], 'сз': ['Семинар', 'sem'], 'лаб': ['Лабораторная', 'lab'] };
const EMOJI = { lec: '📖', pr: '✏️', sem: '💬', lab: '🧪', cur: '👥', fk: '🏃', oth: '📌' };

function ctx(data, group) {
  const nameOf = (c) => { const s = data.subjects[c]; return (s && s.name) || (c === 'КЧ' ? 'Кураторский час' : c); };
  function typeInfo(l) {
    if (l.k) return [l.k, 'exam'];
    if (l.c === 'КЧ') return ['Кураторский час', 'cur'];
    if (l.y && TYPES[l.y]) return l.c === 'ФК' ? ['Занятие', 'fk'] : TYPES[l.y];
    return [l.y ? l.y : 'Занятие', 'oth'];
  }
  function roomOf(l) {
    const s = data.subjects[l.c] || {};
    if (l.r) return l.r;
    if (s.room) return s.room;
    if (s.ext) return '';
    if (l.y === 'л' && data.lectureRoom) return data.lectureRoom;
    if (l.y === 'лаб' && s.labRooms) return s.labRooms.replace(/\s*,\s*/g, ' / ');
    return '';
  }
  function teachersOf(l) {
    if (l.xt) return [{ name: l.xt, pos: '', roles: [] }];
    const s = data.subjects[l.c]; if (!s || !s.teachers) return [];
    let list = s.teachers;
    const gre = /\d[а-яё]\d{4}/i;
    if (list.some((t) => t.roles.some((r) => gre.test(r))))
      list = list.filter((t) => !t.roles.some((r) => gre.test(r)) || t.roles.some((r) => r.toLowerCase().includes(group.toLowerCase())));
    const keys = [];
    if (l.k) keys.push(l.k === 'Экзамен' ? 'экзамен' : 'зачет');
    else if (l.y === 'л') keys.push('лекци');
    else if (l.y === 'лаб') keys.push('лаб');
    else if (l.y === 'пз') keys.push('практ', 'пз');
    else if (l.y === 'сз') keys.push('семин', 'сз');
    if (keys.length) { const m = list.filter((t) => !t.roles.length || t.roles.some((r) => keys.some((k) => r.includes(k)))); if (m.length) list = m; }
    return list;
  }
  return { nameOf, typeInfo, roomOf, teachersOf };
}

/* изменения из админки поверх расписания — та же логика, что в приложении */
function applyChanges(base, group, notices, nameOf) {
  const gMatch = (x) => !x.g || !x.g.length || x.g.includes(group);
  const ch = (notices.changes || []).filter((c) => c && c.d && c.id && gMatch(c));
  const out = base.map((l) => Object.assign({}, l, { ot1: l.t1 }));
  function chLesson(l, c, orig) {
    if (c.c || c.name) {
      if (orig) l.xold = nameOf(orig.c);
      if (c.c) { l.c = c.c; delete l.xn; } else { l.c = c.name; l.xn = 1; }
      if (orig && l.c !== orig.c) { delete l.r; delete l.n; }
      if (orig && l.xold === nameOf(l.c)) delete l.xold;
    }
    if (c.y) { if (/^(зач[её]т|экзамен)$/i.test(c.y)) { l.k = /экз/i.test(c.y) ? 'Экзамен' : 'Зачёт'; delete l.y; } else { l.y = c.y; delete l.k; } }
    if (c.r) l.r = c.r;
    if (c.nt1 && orig && c.nt1 !== orig.t1) l.xot = orig.t1;
    if (c.nt1) l.t1 = c.nt1;
    if (c.nt2) l.t2 = c.nt2;
    if (c.tch) l.xt = c.tch;
    if (c.note) l.xnote = c.note;
    return l;
  }
  for (const c of ch) {
    if (c.act === 'add') {
      if (!c.nt1 || !c.nt2) continue;
      out.push(chLesson({ d: c.d, t1: c.nt1, t2: c.nt2, c: '', x: 'add', xid: c.id }, c, null));
      continue;
    }
    const i = out.findIndex((l) => l.d === c.d && l.t1 === c.t1 && !l.x);
    if (i < 0) continue;
    if (c.act === 'cancel') out[i] = Object.assign({}, out[i], { x: 'cancel', xid: c.id, xnote: c.note || '' });
    else out[i] = chLesson(Object.assign({}, out[i], { x: 'edit', xid: c.id }), c, out[i]);
  }
  out.sort((a, b) => a.d.localeCompare(b.d) || a.t1.localeCompare(b.t1));
  return out;
}

/* ---------------- группы и адреса ---------------- */
const TR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
const slugOf = (g) => [...g.toLowerCase()].map((ch) => TR[ch] !== undefined ? TR[ch] : /[a-z0-9]/.test(ch) ? ch : '-').join('').replace(/-+/g, '-').replace(/^-|-$/g, '');
function findGroup(data, slug) {
  slug = decodeURIComponent(slug || '').toLowerCase();
  return data.groups.find((g) => slugOf(g) === slug || g.toLowerCase() === slug) || null;
}
function readOpts(sp) {
  const f = ['s', 'f', 'c'].includes(sp.get('f')) ? sp.get('f') : 's';
  const a = [5, 10, 15, 30, 60].includes(+sp.get('a')) ? +sp.get('a') : 0;
  return { f, e: sp.get('e') === '1', kch: sp.get('kch') !== '0', fk: sp.get('fk') !== '0', cnl: sp.get('cnl') !== '0', a };
}
function optsQuery(o) {
  const p = [];
  if (o.f !== 's') p.push('f=' + o.f);
  if (o.e) p.push('e=1');
  if (!o.kch) p.push('kch=0');
  if (!o.fk) p.push('fk=0');
  if (!o.cnl) p.push('cnl=0');
  if (o.a) p.push('a=' + o.a);
  return p.length ? '?' + p.join('&') : '';
}

/* ---------------- .ics ---------------- */
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = []; let cur = '', n = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > limit) { parts.push(cur); cur = ''; n = 0; limit = 74; }
    cur += ch; n += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}
function utc(d, t) {
  const [y, m, dd] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, dd, h - TZ_OFFSET, mi)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function buildICS(data, notices, group, o) {
  const C = ctx(data, group), slug = slugOf(group);
  const list = applyChanges(data.lessons[group] || [], group, notices, C.nameOf);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AU schedule//schedule-cal//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsText('Расписание ' + group), 'X-WR-CALDESC:' + icsText('Расписание занятий группы ' + group + '. Срочные изменения — в приложении: ' + APP_LINK),
    'X-WR-TIMEZONE:Europe/Minsk', 'X-APPLE-CALENDAR-COLOR:' + CAL_COLOR, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const used = new Set();
  for (const l of list) {
    const [label, cls] = C.typeInfo(l);
    const cancelled = l.x === 'cancel';
    if (l.c === 'КЧ' && !o.kch) continue;
    if (l.c === 'ФК' && !o.fk) continue;
    if (cancelled && !o.cnl) continue;

    const full = l.xn ? l.c : C.nameOf(l.c);
    const code = l.xn ? l.c : l.c === 'КЧ' ? 'Кураторский час' : l.c;
    let title;
    if (cls === 'exam') title = '📝 ' + (o.f === 'f' ? full : code) + ' · ' + label;
    else if (cls === 'cur') title = 'Кураторский час';
    else if (o.f === 'f') title = full;
    else if (o.f === 'c' || cls === 'fk') title = code;
    else if (l.xn) title = code + (l.y && TYPES[l.y] ? ' · ' + label : '');   // своё название из админки
    else title = code + ' · ' + label;
    if (cancelled) title = '❌ ОТМЕНА · ' + title;
    else if (o.e && cls !== 'exam') title = (EMOJI[cls] || EMOJI.oth) + ' ' + title;

    let uid = l.x === 'add' ? 'add-' + l.xid : slug + '-' + l.d + '-' + (l.ot1 || l.t1).replace(':', '');
    while (used.has(uid)) uid += '-2';
    used.add(uid);

    const room = C.roomOf(l), tch = C.teachersOf(l), s = data.subjects[l.c] || {};
    const desc = [];
    desc.push(cls === 'cur' ? 'Кураторский час' : full + ' — ' + label);
    if (cancelled) desc.push('❌ Пара отменена' + (l.xnote ? ': ' + l.xnote : ''));
    else {
      if (l.xold) desc.push('Вместо: ' + l.xold);
      if (l.xot) desc.push('Перенесена с ' + l.xot);
      if (l.x === 'add') desc.push('Добавленная пара');
      if (l.xnote) desc.push(l.xnote);
    }
    if (tch.length) desc.push((tch.length > 1 ? 'Преподаватели: ' : 'Преподаватель: ') + tch.map((t) => t.name + (t.pos ? ' (' + t.pos + ')' : '')).join('; '));
    else if (s.note) desc.push(s.ext ? 'По расписанию кафедры' : s.note);
    const link = APP_LINK + '?startapp=' + l.d;
    desc.push('', 'Открыть день в приложении: ' + link);

    L.push('BEGIN:VEVENT', 'UID:' + uid + '@schedule-cal', 'DTSTAMP:' + stamp,
      'DTSTART:' + utc(l.d, l.t1), 'DTEND:' + utc(l.d, l.t2),
      'SUMMARY:' + icsText(title));
    if (room) L.push('LOCATION:' + icsText('каб. ' + room));
    L.push('DESCRIPTION:' + icsText(desc.join('\n')), 'URL:' + link);
    if (l.x) L.push('SEQUENCE:1');
    if (cancelled) L.push('TRANSP:TRANSPARENT');
    if (o.a && !cancelled) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(title + (room ? ', каб. ' + room : '')), 'TRIGGER:-PT' + o.a + 'M', 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/* ---------------- страница «Подписаться» ---------------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function subPage(host, group, o, ua) {
  const path = '/cal/' + slugOf(group) + '.ics' + optsQuery(o);
  const https = 'https://' + host + path, webcal = 'webcal://' + host + path;
  const google = 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal);
  const icsx = 'https://play.google.com/store/apps/details?id=at.bitfire.icsdroid';
  const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua));
  const android = /android/i.test(ua);
  const iosBlock = '<div class="card"><h2>📱 iPhone / iPad</h2><a class="btn p" href="' + esc(webcal) + '">Подписаться в «Календаре»</a>' +
    '<p class="sm">Появится окно «Подписаться на календарь» → нажмите <b>«Подписаться»</b>, затем <b>«Готово»</b>. Пары появятся в приложении «Календарь», его виджете и на экране блокировки.</p></div>';
  const andBlock = '<div class="card"><h2>🤖 Android</h2>' +
    '<a class="btn p" href="' + esc(google) + '">Добавить через Google Календарь</a>' +
    '<p class="sm">Откроется страница Google → нажмите <b>«Добавить»</b>. Календарь появится в приложении Google Календарь (и в Samsung Календаре, если там подключён Google-аккаунт). Google обновляет такие календари медленно — раз в 8–24 часа.</p>' +
    '<a class="btn s" href="' + esc(webcal) + '">Через ICSx⁵ — обновления каждый час</a>' +
    '<p class="sm">Нужно бесплатное приложение <a href="' + esc(icsx) + '">ICSx⁵</a>: установите его, вернитесь сюда и нажмите кнопку ещё раз. В ICSx⁵ выберите интервал обновления «1 час».</p></div>';
  const blocks = ios ? iosBlock + '<details><summary>Другой телефон</summary>' + andBlock + '</details>'
    : android ? andBlock + '<details><summary>Другой телефон</summary>' + iosBlock + '</details>' : iosBlock + andBlock;
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">' +
    '<title>Расписание в календарь</title><style>' +
    ':root{color-scheme:dark light;--bg:#0a0a0b;--card:#141416;--line:#2b2b30;--text:#fff;--muted:#8e8e93;--ac:#4f5bff}' +
    '@media (prefers-color-scheme:light){:root{--bg:#f2f2f7;--card:#fff;--line:#dcdce3;--text:#0b0b0c;--muted:#6c6c72}}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px 18px 40px;max-width:520px;margin:0 auto}' +
    'h1{font-size:26px;margin:0 0 4px;letter-spacing:-.02em}h2{font-size:18px;margin:0 0 12px}.lead{color:var(--muted);margin:0 0 20px}' +
    '.card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:18px;margin-bottom:14px}' +
    '.btn{display:block;text-align:center;text-decoration:none;font-weight:800;padding:15px;border-radius:16px;margin:4px 0 10px;border:0;width:100%;font-size:16px;cursor:pointer}' +
    '.btn.p{background:var(--ac);color:#fff}.btn.s{background:var(--line);color:var(--text)}' +
    '.sm{color:var(--muted);font-size:14px;margin:0 0 8px}.sm a{color:var(--ac)}b{color:var(--text)}' +
    'details{margin-bottom:14px}summary{color:var(--muted);font-weight:700;padding:8px 2px;cursor:pointer}' +
    'ul{padding-left:20px;margin:6px 0}li{margin-bottom:6px}.url{font:12px ui-monospace,monospace;word-break:break-all;color:var(--muted);background:var(--bg);border-radius:10px;padding:10px;margin:8px 0}' +
    '</style></head><body>' +
    '<h1>📅 Расписание в календарь</h1><p class="lead">Группа <b>' + esc(group) + '</b>. Пары будут видны в календаре телефона и его виджете — без захода в приложение.</p>' +
    blocks +
    '<div class="card"><h2>Важно</h2><ul class="sm">' +
    '<li><b>Подпишитесь один раз.</b> Если нажать дважды, пары задвоятся — тогда удалите лишний календарь.</li>' +
    '<li>Календарь обновляется сам, но с задержкой (iPhone — примерно раз в час). <b>Срочные изменения</b> смотрите в приложении.</li>' +
    '<li>Сменили группу или настройки — сначала удалите старый календарь: iPhone — «Настройки → Календарь → Учётные записи»; Google — calendar.google.com → «Настройки» → календарь → «Удалить».</li>' +
    '</ul><details><summary>Ссылка для ручного добавления</summary><div class="url" id="u">' + esc(https) + '</div><button class="btn s" id="cp">Скопировать</button></details></div>' +
    '<script>document.getElementById("cp").onclick=function(){var t=document.getElementById("u").textContent;try{navigator.clipboard.writeText(t);this.textContent="Скопировано ✓"}catch(e){prompt("Скопируйте ссылку",t)}};' +
    (ios ? 'setTimeout(function(){location.href=' + JSON.stringify(webcal) + '},600);' : '') + '</script>' +
    '</body></html>';
}


/* =====================================================================
   Ежедневное сообщение «Завтра у тебя…» от бота (в 20:00 по Минску)
   Нужно в настройках воркера (см. worker/README.md):
     KV-хранилище с именем переменной KV, секреты BOT_TOKEN и STATS_KEY,
     Cron Trigger «0-9 17 * * *» (17:00–17:09 UTC = 20:00–20:09 Минск).
   Без них календарь работает как раньше, просто рассылки нет.
   ===================================================================== */
const STATS_API = 'https://schedule-stats.yotonick.workers.dev';  // откуда брать список людей
const DEV_USERNAME = 'yotonick';                                   // кому слать тестовое сообщение
const BATCH = 40;        // сколько сообщений за один запуск (лимит бесплатного Cloudflare — 50 запросов наружу)
const WDN = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const minskKey = (offsetDays) => new Date(Date.now() + TZ_OFFSET * 3600e3 + (offsetDays || 0) * 864e5).toISOString().slice(0, 10);
const keyDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const h = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const n1 = n % 10; return n > 10 && n < 20 ? c : n1 > 1 && n1 < 5 ? b : n1 === 1 ? a : c; };

/* название пары как в календаре по умолчанию: «АХД · Лекция» */
function shortTitle(C, l) {
  const [label, cls] = C.typeInfo(l);
  const code = l.xn ? l.c : l.c === 'КЧ' ? 'Кураторский час' : l.c;
  if (cls === 'exam') return '📝 ' + code + ' · ' + label;
  if (cls === 'cur') return 'Кураторский час';
  if (l.c === 'ФК') return 'ФК';
  if (l.xn) return code + (l.y && TYPES[l.y] ? ' · ' + label : '');
  return code + ' · ' + label;
}
function dayList(data, notices, group, k) {
  const C = ctx(data, group);
  return { C, list: applyChanges(data.lessons[group] || [], group, notices, C.nameOf).filter((l) => l.d === k) };
}
/* текст сообщения на завтра; null — не отправлять */
function buildMessage(data, notices, group, meta) {
  const T = minskKey(0), D = minskKey(1), dd = keyDate(D);
  const all = data.lessons[group] || [];
  if (!all.length || D > all[all.length - 1].d) return null;      // семестр закончился
  const { C, list } = dayList(data, notices, group, D);
  const live = list.filter((l) => l.x !== 'cancel');
  if (!list.length && dd.getUTCDay() === 0) return null;          // воскресенье без пар — молчим
  const when = 'Завтра, ' + WDN[dd.getUTCDay()] + ', ' + dd.getUTCDate() + ' ' + MON[dd.getUTCMonth()];
  const L = [];
  if (!live.length) L.push('🎉 <b>' + when + '</b> — пар нет' + (list.length ? ' (все отменены)' : ''));
  else L.push('📅 <b>' + when + '</b> — ' + live.length + ' ' + plural(live.length, 'пара', 'пары', 'пар'));
  if (list.length) L.push('');
  for (const l of list) {
    const room = C.roomOf(l);
    if (l.x === 'cancel') { L.push('❌ <s>' + l.t1 + ' ' + h(shortTitle(C, l)) + '</s> — отменена' + (l.xnote ? ': ' + h(l.xnote) : '')); continue; }
    L.push((l.x ? '🔄 ' : '') + '<b>' + l.t1 + '</b> ' + h(shortTitle(C, l)) + (room ? ' · каб. ' + h(room) : ''));
    if (l.xold) L.push('      <i>вместо ' + h(l.xold) + '</i>');
    if (l.xot) L.push('      <i>перенесена с ' + l.xot + '</i>');
    if (l.xnote) L.push('      <i>' + h(l.xnote) + '</i>');
  }
  /* серия дней из приложения */
  const st = meta && +meta.st || 0;
  if (st >= 2) {
    if (meta.sd === T) L.push('', '🔥 Серия: <b>' + st + ' ' + plural(st, 'день', 'дня', 'дней') + '</b> — загляни завтра, чтобы не прервать');
    else {
      const todayHas = all.some((l) => l.d === T);
      const prev = [...new Set(all.map((l) => l.d))].filter((k) => k < T).pop();
      if (todayHas && meta.sd && prev && meta.sd >= prev) L.push('', '⚠️ Твоя серия 🔥' + st + ' сгорит в полночь — открой приложение сегодня');
    }
  }
  L.push('', '<i>Отключить: в приложении → Настройки → Уведомления</i>');
  return L.join('\n');
}

/* --- хранилище: ключ rem:u:<id>, всё в metadata {grp, off, blk, st, sd} --- */
async function getMeta(env, id) { const r = await env.KV.getWithMetadata('rem:u:' + id); return (r && r.metadata) || {}; }
async function putMeta(env, id, m) { await env.KV.put('rem:u:' + id, '1', { metadata: m }); }
async function allMeta(env) {
  const out = {}; let cursor;
  do {
    const r = await env.KV.list({ prefix: 'rem:u:', cursor });
    for (const k of r.keys) out[k.name.slice(6)] = k.metadata || {};
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}
async function statsUsers(env) {
  const r = await fetch(STATS_API + '/api/admin/overview?days=1', { headers: { authorization: 'Bearer ' + env.STATS_KEY } });
  if (!r.ok) throw new Error('статистика: HTTP ' + r.status);
  const j = await r.json();
  return (j.users || []).filter((u) => +u.id > 0);
}
async function tgSend(env, chatId, textMsg, date) {
  const r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text: textMsg, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '📅 Открыть расписание', web_app: { url: SITE + 'schedule.html?date=' + date } }]] }
    })
  });
  const j = await r.json().catch(() => ({}));
  if (j.ok) return 'ok';
  if (j.error_code === 429) return 'wait';
  if (j.error_code === 403 || (j.error_code === 400 && /chat not found|user is deactivated/i.test(j.description || ''))) return 'blocked';
  return 'error: ' + (j.description || r.status);
}
const remReady = (env) => !!(env && env.KV && env.BOT_TOKEN && env.STATS_KEY);

/* один запуск рассылки (cron вызывает его 10 раз подряд по минуте — так влезаем в лимиты) */
async function runDaily(env) {
  if (!remReady(env)) return { skipped: 'не настроены KV / BOT_TOKEN / STATS_KEY' };
  const T = minskKey(0);
  if (await env.KV.get('rem:done:' + T)) return { done: true };
  const [users, metas, st] = await Promise.all([statsUsers(env), allMeta(env), load()]);
  const sent = new Set(JSON.parse((await env.KV.get('rem:sent:' + T)) || '[]'));
  const res = { ok: 0, blocked: 0, skipped: 0, errors: [] };
  let n = 0, finished = true;
  for (const u of users) {
    const id = String(u.id);
    if (sent.has(id)) continue;
    const meta = metas[id] || {};
    const group = meta.grp || u.grp;
    if (meta.off || meta.blk || !group || !st.data.groups.includes(group)) { sent.add(id); res.skipped++; continue; }
    const msg = buildMessage(st.data, st.notices, group, meta);
    if (!msg) { sent.add(id); res.skipped++; continue; }
    if (n >= BATCH) { finished = false; break; }
    n++;
    const r = await tgSend(env, id, msg, minskKey(1));
    if (r === 'wait') { finished = false; break; }
    if (r === 'blocked') { await putMeta(env, id, Object.assign({}, meta, { grp: group, blk: 1 })); res.blocked++; }
    else if (r === 'ok') res.ok++;
    else res.errors.push(id + ': ' + r);
    sent.add(id);
  }
  await env.KV.put('rem:sent:' + T, JSON.stringify([...sent]), { expirationTtl: 3 * 86400 });
  if (finished) await env.KV.put('rem:done:' + T, '1', { expirationTtl: 3 * 86400 });
  return Object.assign(res, { finished });
}

/* --- проверка данных из Telegram Mini App (initData) --- */
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
async function tgUser(initData, token) {
  try {
    const p = new URLSearchParams(initData || ''); const hash = p.get('hash'); if (!hash) return null;
    p.delete('hash');
    const dcs = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
    const secret = await hmac('WebAppData', token);
    const sig = [...(await hmac(secret, dcs))].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (sig !== hash) return null;
    if (Date.now() / 1000 - (+p.get('auth_date') || 0) > 30 * 86400) return null;
    const u = JSON.parse(p.get('user') || 'null');
    return u && u.id ? u : null;
  } catch (e) { return null; }
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, CORS) });

async function api(request, env, path) {
  if (!remReady(env)) return json({ ok: false, error: 'not configured' }, 503);
  let body = {}; try { body = await request.json(); } catch (e) {}
  const u = await tgUser(body.initData, env.BOT_TOKEN);
  if (!u) return json({ ok: false, error: 'bad initData' }, 401);
  const id = String(u.id), meta = await getMeta(env, id);
  const st = await load().catch(() => null);
  const okGroup = (g) => g && st && st.data.groups.includes(g);
  if (path === '/api/me') return json({ ok: true, prefs: { evening: !meta.off }, reachable: !meta.blk });
  if (path === '/api/settings') {
    const pr = body.prefs || {};
    if (typeof pr.evening === 'boolean') { if (pr.evening) { delete meta.off; delete meta.blk; } else meta.off = 1; }
    if (okGroup(pr.group)) meta.grp = pr.group;
    await putMeta(env, id, meta);
    return json({ ok: true, prefs: { evening: !meta.off }, reachable: !meta.blk });
  }
  if (path === '/api/hello') {
    const streak = Math.max(0, Math.min(10000, +body.streak | 0));
    const day = /^\d{4}-\d{2}-\d{2}$/.test(body.day || '') ? body.day : minskKey(0);
    if (meta.st !== streak || meta.sd !== day || (okGroup(body.group) && meta.grp !== body.group)) {
      meta.st = streak; meta.sd = day; if (okGroup(body.group)) meta.grp = body.group;
      await putMeta(env, id, meta);
    }
    return json({ ok: true, reachable: !meta.blk, evening: !meta.off });
  }
  return json({ ok: false, error: 'not found' }, 404);
}

/* служебные адреса для вас: /remind/test?key=…  /remind/status?key=… (key — ключ статистики) */
async function remindAdmin(url, env) {
  if (!remReady(env)) return text('Рассылка не настроена: нужны KV, BOT_TOKEN и STATS_KEY (см. worker/README.md)', 503);
  if (url.searchParams.get('key') !== env.STATS_KEY) return text('Неверный key', 403);
  const T = minskKey(0);
  if (url.pathname === '/remind/status') {
    const [users, metas, sent, done] = await Promise.all([statsUsers(env), allMeta(env), env.KV.get('rem:sent:' + T), env.KV.get('rem:done:' + T)]);
    const m = Object.values(metas);
    return text('Людей в статистике: ' + users.length + '\nОтключили напоминания: ' + m.filter((x) => x.off).length +
      '\nБот не может написать (не нажимали «Старт»): ' + m.filter((x) => x.blk).length +
      '\nСегодня обработано: ' + (sent ? JSON.parse(sent).length : 0) + (done ? ' (рассылка завершена)' : ''));
  }
  const users = await statsUsers(env);
  const me = users.find((u) => String(u.username || '').toLowerCase() === DEV_USERNAME);
  if (!me) return text('Не нашёл @' + DEV_USERNAME + ' в статистике — откройте приложение через Telegram', 404);
  const meta = await getMeta(env, me.id), st = await load();
  const group = meta.grp || me.grp || st.data.groups[0];
  const msg = buildMessage(st.data, st.notices, group, meta) || '(завтра сообщение не отправилось бы: воскресенье без пар или конец семестра)';
  const r = await tgSend(env, me.id, msg, minskKey(1));
  return text(r === 'ok' ? 'Отправлено вам в Telegram ✓' : 'Не отправилось: ' + r + (r === 'blocked' ? ' — нажмите «Старт» у бота' : ''));
}

/* ---------------- маршруты ---------------- */
const text = (s, status) => new Response(s, { status: status || 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDaily(env).then((r) => console.log('daily', JSON.stringify(r))).catch((e) => console.log('daily error', e.message)));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) return api(request, env, url.pathname);
    if (request.method !== 'GET' && request.method !== 'HEAD') return text('Method not allowed', 405);
    if (url.pathname === '/remind/test' || url.pathname === '/remind/status') {
      try { return await remindAdmin(url, env); } catch (e) { return text('Ошибка: ' + e.message, 500); }
    }
    const m = /^\/(cal|sub)\/([^/]+?)(?:\.ics)?\/?$/.exec(url.pathname);
    if (url.pathname === '/' || url.pathname === '') return text('schedule-cal работает');
    if (!m) return text('Не найдено', 404);
    let st;
    try { st = await load(); } catch (e) { return text('Расписание временно недоступно, попробуйте позже (' + e.message + ')', 503); }
    const group = findGroup(st.data, m[2]);
    if (!group) return text('Группа не найдена. Доступные: ' + st.data.groups.map(slugOf).join(', '), 404);
    const o = readOpts(url.searchParams);
    if (m[1] === 'sub') {
      return new Response(subPage(url.host, group, o, request.headers.get('user-agent') || ''), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const ics = buildICS(st.data, st.notices, group, o);
    return new Response(request.method === 'HEAD' ? null : ics, {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'inline; filename="' + slugOf(group) + '.ics"',
        'cache-control': 'public, max-age=300',
        'access-control-allow-origin': '*'
      }
    });
  }
};

/* для локальных тестов (node) */
export { buildICS, slugOf, applyChanges, readOpts, subPage, buildMessage, runDaily, tgUser, api };
