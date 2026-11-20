/* Собирает из schedule.xlsx (тем же парсером, что и приложение):
   - schedule.json       — краткий формат (как раньше, не менять: им могут пользоваться другие сервисы);
   - schedule-full.json  — полный разбор (коды предметов, типы, преподаватели) для календаря (worker/schedule-cal.js).
   Запуск: node tools/build-schedule.js [путь/к/schedule.xlsx] [путь/к/schedule.json] */
const fs = require('fs'), path = require('path');
const { DOMParser } = require('linkedom');
globalThis.DOMParser = DOMParser;
require('./parser.js');

const root = path.join(__dirname, '..');
const src = path.resolve(process.argv[2] || path.join(root, 'schedule.xlsx'));
const dst = path.resolve(process.argv[3] || path.join(root, 'schedule.json'));
const dstFull = path.join(path.dirname(dst), 'schedule-full.json');
const buf = fs.readFileSync(src);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const data = globalThis.parseSchedule(globalThis.readXlsx(ab), path.basename(src));

const lessonsTotal = Object.values(data.lessons).reduce((a, b) => a + b.length, 0);
if (!data.groups.length || !lessonsTotal) { console.error('В файле не найдено ни одного занятия — файлы не обновлены'); process.exit(1); }

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

/* полный формат: без поля loaded (иначе файл менялся бы при каждой сборке) */
const full = Object.assign({}, data);
delete full.loaded;
delete full.file;

function write(file, json) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === json) { console.log(path.basename(file) + ' без изменений'); return; }
  fs.writeFileSync(file, json);
  console.log(path.basename(file) + ' записан');
}
write(dst, JSON.stringify(out));
write(dstFull, JSON.stringify(full));
console.log('групп ' + out.groups.length + ', занятий ' + lessonsTotal + (data.warnings.length ? ', предупреждения: ' + data.warnings.join('; ') : ''));
