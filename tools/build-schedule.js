/* Собирает schedule.json из schedule.xlsx тем же парсером, что и приложение.
   Запуск: node tools/build-schedule.js [путь/к/schedule.xlsx] [путь/к/schedule.json] */
const fs = require('fs'), path = require('path');
const { DOMParser } = require('linkedom');
globalThis.DOMParser = DOMParser;
require('./parser.js');

const src = path.resolve(process.argv[2] || path.join(__dirname, '..', 'schedule.xlsx'));
const dst = path.resolve(process.argv[3] || path.join(__dirname, '..', 'schedule.json'));
const buf = fs.readFileSync(src);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const data = globalThis.parseSchedule(globalThis.readXlsx(ab), path.basename(src));

const TYPES = { 'л': 'Лекция', 'пз': 'Практика', 'сз': 'Семинар', 'лаб': 'Лабораторная' };
const label = (l) => l.k ? l.k : l.c === 'КЧ' ? 'Кураторский час' : (l.y && TYPES[l.y]) ? (l.c === 'ФК' ? 'Занятие' : TYPES[l.y]) : (l.y || 'Занятие');
const nameOf = (c) => (data.subjects[c] && data.subjects[c].name) || (c === 'КЧ' ? 'Кураторский час' : c);
function roomOf(l) {
  const s = data.subjects[l.c] || {};
  if (l.r) return l.r;
  if (s.room) return s.room;
  if (s.ext) return '';
  if (l.y === 'л' && data.lectureRoom) return data.lectureRoom;
  if (l.y === 'лаб' && s.labRooms) return s.labRooms.replace(/\s*,\s*/g, ' / ');
  return '';
}
const out = { v: 1, groups: data.groups, lessons: {} };
for (const g of data.groups) {
  out.lessons[g] = (data.lessons[g] || []).map((l) => {
    const o = { d: l.d, t1: l.t1, t2: l.t2, n: nameOf(l.c), y: label(l) };
    const r = roomOf(l); if (r) o.r = r;
    return o;
  });
}
const json = JSON.stringify(out);
if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === json) { console.log('schedule.json без изменений'); process.exit(0); }
fs.writeFileSync(dst, json);
console.log('schedule.json записан: групп ' + out.groups.length + ', занятий ' + Object.values(out.lessons).reduce((a, b) => a + b.length, 0) + (data.warnings.length ? ', предупреждения: ' + data.warnings.join('; ') : ''));
