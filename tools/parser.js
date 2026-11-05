// АВТОГЕНЕРИРУЕТСЯ из schedule.html: тот же парсер, что работает в приложении. Не редактировать вручную.
/* Мини-читатель .xlsx без зависимостей: zip + inflate + XML.
   readXlsx(ArrayBuffer) -> { get(r,c), merges:[{r1,c1,r2,c2}], maxR, maxC }  (индексы с 0) */
(function (root) {
  'use strict';

  /* ---------- inflate (RFC1951), порт идеи puff.c ---------- */
  const LB = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const LE = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const DB = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const DE = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  const ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  function huff(lengths) {
    const count = new Uint16Array(16), symbol = new Uint16Array(lengths.length), offs = new Uint16Array(16);
    for (let i = 0; i < lengths.length; i++) count[lengths[i]]++;
    count[0] = 0;
    for (let i = 1; i < 15; i++) offs[i + 1] = offs[i] + count[i];
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
    return { count, symbol };
  }

  function inflate(data) {
    let p = 0, bitbuf = 0, bitcnt = 0, out = new Uint8Array(Math.max(1024, data.length * 4)), o = 0;
    const bits = (n) => {
      while (bitcnt < n) { if (p >= data.length) throw new Error('inflate: EOF'); bitbuf |= data[p++] << bitcnt; bitcnt += 8; }
      const v = bitbuf & ((1 << n) - 1); bitbuf >>>= n; bitcnt -= n; return v;
    };
    const decode = (h) => {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len <= 15; len++) {
        code |= bits(1);
        const c = h.count[len];
        if (code - c < first) return h.symbol[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw new Error('inflate: bad code');
    };
    const put = (b) => { if (o >= out.length) { const n = new Uint8Array(out.length * 2); n.set(out); out = n; } out[o++] = b; };

    let fixedL, fixedD;
    const codes = (hl, hd) => {
      for (;;) {
        let sym = decode(hl);
        if (sym < 256) put(sym);
        else if (sym === 256) return;
        else {
          sym -= 257;
          const len = LB[sym] + bits(LE[sym]);
          const ds = decode(hd);
          const dist = DB[ds] + bits(DE[ds]);
          for (let i = 0; i < len; i++) put(out[o - dist]);
        }
      }
    };

    let last;
    do {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        bitbuf = 0; bitcnt = 0;
        const len = data[p] | (data[p + 1] << 8); p += 4;
        for (let i = 0; i < len; i++) put(data[p++]);
      } else if (type === 1) {
        if (!fixedL) {
          const l = new Uint8Array(288);
          for (let i = 0; i < 144; i++) l[i] = 8;
          for (let i = 144; i < 256; i++) l[i] = 9;
          for (let i = 256; i < 280; i++) l[i] = 7;
          for (let i = 280; i < 288; i++) l[i] = 8;
          fixedL = huff(l); fixedD = huff(new Uint8Array(30).fill(5));
        }
        codes(fixedL, fixedD);
      } else if (type === 2) {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        const lens = new Uint8Array(320);
        const cl = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) cl[ORDER[i]] = bits(3);
        const hc = huff(cl);
        let idx = 0;
        while (idx < nlen + ndist) {
          const sym = decode(hc);
          if (sym < 16) lens[idx++] = sym;
          else {
            let prev = 0, rep;
            if (sym === 16) { prev = lens[idx - 1]; rep = 3 + bits(2); }
            else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            while (rep--) lens[idx++] = prev;
          }
        }
        codes(huff(lens.subarray(0, nlen)), huff(lens.subarray(nlen, nlen + ndist)));
      } else throw new Error('inflate: bad block');
    } while (!last);
    return out.subarray(0, o);
  }

  /* ---------- zip ---------- */
  function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Это не .xlsx (не найден zip-архив)');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const td = new TextDecoder('utf-8'), files = {};
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
      files[name] = { method, csize, lho };
      p += 46 + nl + el + cl;
    }
    const read = (name) => {
      const f = files[name]; if (!f) return null;
      const s = f.lho + 30 + dv.getUint16(f.lho + 26, true) + dv.getUint16(f.lho + 28, true);
      const raw = u8.subarray(s, s + f.csize);
      const bytes = f.method === 0 ? raw : inflate(raw);
      return td.decode(bytes);
    };
    return { names: Object.keys(files), read };
  }

  /* ---------- xlsx ---------- */
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const colNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const ref = (s) => { const m = /^([A-Z]+)(\d+)$/.exec(s); return m ? { c: colNum(m[1]), r: +m[2] - 1 } : null; };

  function readXlsx(buf) {
    const zip = unzip(buf);
    // shared strings
    const sst = [];
    const sx = zip.read('xl/sharedStrings.xml');
    if (sx) {
      const d = xml(sx);
      for (const si of d.getElementsByTagName('si')) {
        let t = '';
        for (const x of si.getElementsByTagName('t')) if (x.parentNode.nodeName !== 'rPh') t += x.textContent;
        sst.push(t);
      }
    }
    // первый лист
    let sheetPath = null;
    try {
      const wb = xml(zip.read('xl/workbook.xml'));
      const rid = wb.getElementsByTagName('sheet')[0].getAttribute('r:id');
      const rels = xml(zip.read('xl/_rels/workbook.xml.rels'));
      for (const r of rels.getElementsByTagName('Relationship')) {
        if (r.getAttribute('Id') === rid) {
          let t = r.getAttribute('Target');
          sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
        }
      }
    } catch (e) { /* fallback ниже */ }
    if (!sheetPath || !zip.names.includes(sheetPath))
      sheetPath = zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    if (!sheetPath) throw new Error('В файле не найден лист с данными');

    const d = xml(zip.read(sheetPath));
    const cells = new Map();
    let maxR = 0, maxC = 0;
    for (const c of d.getElementsByTagName('c')) {
      const a = ref(c.getAttribute('r')); if (!a) continue;
      const t = c.getAttribute('t');
      let val = '';
      if (t === 'inlineStr') {
        for (const x of c.getElementsByTagName('t')) val += x.textContent;
      } else {
        const v = c.getElementsByTagName('v')[0];
        if (!v) continue;
        val = t === 's' ? (sst[+v.textContent] ?? '') : v.textContent;
      }
      if (val === '') continue;
      cells.set(a.r + ',' + a.c, val);
      if (a.r > maxR) maxR = a.r;
      if (a.c > maxC) maxC = a.c;
    }
    const merges = [];
    for (const m of d.getElementsByTagName('mergeCell')) {
      const [a, b] = m.getAttribute('ref').split(':');
      const A = ref(a), B = ref(b || a);
      if (A && B) merges.push({ r1: A.r, c1: A.c, r2: B.r, c2: B.c });
    }
    return { get: (r, c) => cells.get(r + ',' + c) ?? '', merges, maxR, maxC };
  }

  root.readXlsx = readXlsx;
})(typeof window !== 'undefined' ? window : globalThis);

/* Разбор расписания Академии управления (формат: блоки недель, по колонке на группу).
   parseSchedule(grid, fileName) -> data (JSON-сериализуемый объект) */
(function (root) {
  'use strict';
  const WD = { 'понедельник': 0, 'вторник': 1, 'среда': 2, 'четверг': 3, 'пятница': 4, 'суббота': 5, 'воскресенье': 6 };
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const ROMAN = { I: 1, V: 5, X: 10, L: 50 };
  const roman = (s) => { let n = 0; for (let i = 0; i < s.length; i++) { const a = ROMAN[s[i]], b = ROMAN[s[i + 1]] || 0; n += a < b ? -a : a; } return n; };
  const TIME = /(\d{1,2})[.:](\d{2})/g;
  const hhmm = (h, m) => pad(+h) + ':' + m;

  function parseCell(raw) {
    const lines = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    let kind = '', time = '';
    const rest = [];
    for (const ln of lines) {
      let m;
      if (/^\d{1,2}[.:]\d{2}$/.test(ln)) time = ln.replace('.', ':');
      else if ((m = /^(зачет|зачёт|экзамен)(?=\s|$)\s*(.*)$/i.exec(ln))) {
        kind = /экзамен/i.test(m[1]) ? 'Экзамен' : 'Зачёт';
        if (m[2]) rest.push(m[2]);
      } else rest.push(ln);
    }
    const text = rest.join(' ');
    const m = /^([^\s(,]+)\s*(?:\(([^)]+)\))?\s*(?:,?\s*а\.\s*([^\s,]+))?\s*(.*)$/.exec(text);
    return { code: m ? m[1] : text, type: m && m[2] ? m[2].trim().toLowerCase() : '', room: m && m[3] ? m[3] : '', note: m && m[4] ? m[4] : '', kind, time };
  }

  function parseTeachers(text) {
    const res = [];
    const re = /([а-яё]+(?:\s+[а-яё]+)*)\s+([А-ЯЁ][а-яё-]+\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.)\s*(?:\(([^)]*)\))?/g;
    let m;
    while ((m = re.exec(text))) {
      res.push({ pos: m[1].trim(), name: m[2].replace(/\s+/g, ' ').trim(), roles: m[3] ? m[3].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [] });
    }
    return res;
  }

  function parseSchedule(g, fileName) {
    // объединённые ячейки
    const mergeAt = new Map();
    for (const m of g.merges) {
      if ((m.r2 - m.r1 + 1) * (m.c2 - m.c1 + 1) > 400) continue;
      for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) mergeAt.set(r + ',' + c, m);
    }
    const get = (r, c) => String(g.get(r, c) || '').trim();
    const cellValue = (r, c) => {           // значение занятия в клетке с учётом объединений
      const m = mergeAt.get(r + ',' + c);
      if (m) return r === m.r1 ? get(m.r1, m.c1) : '';
      return get(r, c);
    };

    // шапка
    const meta = {};
    const labels = { 'учебный год': 'year', 'специальность': 'specialty', 'курс': 'course', 'семестр': 'semester', 'форма получения образования': 'form' };
    for (let r = 0; r < Math.min(14, g.maxR); r++) {
      const k = labels[get(r, 0).toLowerCase()];
      if (k) for (let c = 1; c <= g.maxC; c++) { const v = get(r, c); if (v) { meta[k] = v; break; } }
    }

    // дисциплины и преподаватели
    const subjects = {};
    let legR = -1;
    for (let r = 0; r <= g.maxR; r++) if (get(r, 0) === '№') { legR = r; break; }
    if (legR >= 0) {
      let colForm = -1, colTeach = -1;
      for (let c = 0; c <= g.maxC; c++) {
        const t = get(legR, c).toLowerCase();
        if (t.startsWith('форма')) colForm = c;
        if (t.startsWith('должность')) colTeach = c;
      }
      for (let r = legR + 2; r <= g.maxR; r++) {
        if (!/^\d+$/.test(get(r, 0))) break;
        const code = get(r, 1); if (!code) continue;
        const teachText = colTeach >= 0 ? get(r, colTeach) : '';
        const teachers = parseTeachers(teachText);
        const s = { name: get(r, 2) || code, exam: colForm >= 0 ? get(r, colForm) : '', teachers, note: '', room: '', ext: false, labRooms: '' };
        if (!teachers.length && teachText) {
          s.note = teachText.replace(/\s+/g, ' ');
          s.ext = /согласно расписанию/i.test(teachText);
          const rm = /каб\.?\s*([\w/]+)/i.exec(teachText);
          if (rm) s.room = rm[1];
        } else if (teachText) s.raw = teachText.replace(/\s+/g, ' ');
        subjects[code] = s;
      }
    }

    // аудитории из шапки
    let lectureRoom = '';
    const firstHdr = (() => { for (let r = 0; r <= g.maxR; r++) if (get(r, 0) === 'День нед.') return r; return g.maxR; })();
    for (let r = 0; r < firstHdr; r++) {
      for (let c = 0; c <= g.maxC; c++) {
        const t = get(r, c); if (!t) continue;
        const nextVal = () => { for (let k = c + 1; k <= g.maxC; k++) { const v = get(r, k); if (v) return v; } return ''; };
        if (/лекционная аудитория/i.test(t)) lectureRoom = nextVal();
        else if (subjects[t]) subjects[t].labRooms = nextVal();
      }
    }

    // блоки недель
    const weeks = [], lessons = {}, groupsSet = [], warnings = [];
    for (let r0 = 0; r0 <= g.maxR; r0++) {
      if (get(r0, 0) !== 'День нед.') continue;
      const cols = [];
      for (let c = 0; c <= g.maxC; c++) {
        const mm = /^([IVXL]+)\s+неделя/.exec(get(r0, c));
        if (!mm) continue;
        const rg = /(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(get(r0 + 1, c));
        if (!rg) continue;
        const groups = [];
        for (let k = 0; k < 4; k++) { const gn = get(r0 + 2, c + k); if (gn && !/неделя|дата/i.test(gn)) groups.push({ name: gn, col: c + k }); else break; }
        cols.push({ n: roman(mm[1]), start: new Date(+rg[3], +rg[2] - 1, +rg[1]), end: new Date(+rg[6], +rg[5] - 1, +rg[4]), groups });
      }
      cols.forEach((w) => { weeks.push({ n: w.n, start: key(w.start), end: key(w.end) }); w.groups.forEach((gr) => { if (!groupsSet.includes(gr.name)) groupsSet.push(gr.name); }); });

      // дни и пары
      let day = -1, slot = 0;
      for (let r = r0 + 3; r <= g.maxR; r++) {
        const a = get(r, 0);
        if (a === 'День нед.' || a.startsWith('Изучаемые')) break;
        if (WD[a.toLowerCase()] !== undefined) { day = WD[a.toLowerCase()]; slot = 0; }
        if (day < 0) continue;
        const times = [...get(r, 1).matchAll(TIME)];
        if (!times.length) continue;
        slot++;
        const t1 = hhmm(times[0][1], times[0][2]), t2 = hhmm(times[times.length - 1][1], times[times.length - 1][2]);
        for (const w of cols) {
          const d = new Date(w.start.getFullYear(), w.start.getMonth(), w.start.getDate() + day);
          for (const gr of w.groups) {
            const raw = cellValue(r, gr.col);
            if (!raw) continue;
            const p = parseCell(raw);
            const L = { d: key(d), s: slot, t1: p.time && p.time.length >= 4 ? hhmm(...p.time.split(':')) : t1, t2, c: p.code };
            if (p.type) L.y = p.type;
            if (p.kind) L.k = p.kind;
            if (p.room) L.r = p.room;
            if (p.note) L.n = p.note;
            if (!subjects[p.code] && !/^КЧ$/.test(p.code)) warnings.push('Неизвестный предмет: ' + p.code);
            (lessons[gr.name] = lessons[gr.name] || []).push(L);
          }
        }
      }
    }
    if (!weeks.length || !groupsSet.length) throw new Error('Не найдена таблица расписания. Структура файла должна совпадать с исходной.');
    weeks.sort((a, b) => a.start.localeCompare(b.start));
    for (const k in lessons) lessons[k].sort((a, b) => a.d.localeCompare(b.d) || a.s - b.s);
    return { v: 1, file: fileName || '', loaded: new Date().toISOString(), meta, groups: groupsSet, weeks, lessons, subjects, lectureRoom, warnings: [...new Set(warnings)] };
  }

  root.parseSchedule = parseSchedule;
})(typeof window !== 'undefined' ? window : globalThis);

