/* 배정 로직 왕복 검증 — Apps Script 흉내(SpreadsheetApp·LockService·Utilities 스텁)로
 * assignAdd → assignList → myAssign → assignSet → assignDel 흐름과
 * 행 밀림(time 대조)·대상 매칭 규칙을 검사한다.
 *   실행: node tools/assign-stub-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ===== Apps Script 스텁 ===== */
function FakeRange(sheet, r, c, nr, nc) { this.sh = sheet; this.r = r; this.c = c; this.nr = nr || 1; this.nc = nc || 1; }
FakeRange.prototype.setNumberFormat = function () { return this; };
FakeRange.prototype.setValue = function (v) {
  while (this.sh.grid.length < this.r) this.sh.grid.push([]);
  this.sh.grid[this.r - 1][this.c - 1] = v; return this;
};
FakeRange.prototype.setValues = function (vals) {
  for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
    while (this.sh.grid.length < this.r + i) this.sh.grid.push([]);
    this.sh.grid[this.r - 1 + i][this.c - 1 + j] = vals[i][j];
  }
  return this;
};
FakeRange.prototype.getValue = function () { return (this.sh.grid[this.r - 1] || [])[this.c - 1] ?? ''; };
FakeRange.prototype.getValues = function () {
  const out = [];
  for (let i = 0; i < this.nr; i++) {
    const row = [];
    for (let j = 0; j < this.nc; j++) row.push((this.sh.grid[this.r - 1 + i] || [])[this.c - 1 + j] ?? '');
    out.push(row);
  }
  return out;
};
function FakeSheet(name) { this.name = name; this.grid = []; }
FakeSheet.prototype.getLastRow = function () { return this.grid.length; };
FakeSheet.prototype.getLastColumn = function () { return this.grid.length ? Math.max(...this.grid.map(r => r.length)) : 0; };
FakeSheet.prototype.getMaxRows = function () { return Math.max(this.grid.length, 1000); };
FakeSheet.prototype.appendRow = function (row) { this.grid.push(row.slice()); };
// 실제 시트처럼 getRange는 내용을 만들지 않는다 (쓸 때만 setValue/setValues가 늘림)
FakeSheet.prototype.getRange = function (r, c, nr, nc) { return new FakeRange(this, r, c, nr, nc); };
FakeSheet.prototype.getDataRange = function () { return new FakeRange(this, 1, 1, Math.max(this.grid.length, 1), this.getLastColumn() || 1); };
FakeSheet.prototype.deleteRow = function (rn) { this.grid.splice(rn - 1, 1); };

const ss = {
  sheets: { '결과': new FakeSheet('결과') },
  getSheetByName(n) { return this.sheets[n] || null; },
  getSheets() { return Object.values(this.sheets); },
  insertSheet(n) { this.sheets[n] = new FakeSheet(n); return this.sheets[n]; }
};
global.SpreadsheetApp = { getActiveSpreadsheet: () => ss };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
global.ContentService = {
  MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
  createTextOutput: (s) => ({ _s: s, setMimeType() { return this; } })
};
global.Utilities = {
  formatDate: (d) => {
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  },
  computeDigest: (a, s) => { let h = []; for (let i = 0; i < 16; i++) h.push((s.length * 7 + i * 13) % 256); return h; },
  DigestAlgorithm: { MD5: 'md5' },
  Charset: { UTF_8: 'utf8' }
};

/* ===== Code.gs 로드 ===== */
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8')); // 간접 eval = 전역 스코프(비엄격)에서 실행
const doGet = global.doGet, doPost = global.doPost;

function GET(params) { return JSON.parse(doGet({ parameter: params })._s); }
const KEY = { key: 'shueguk2026' };
let n = 0, bad = 0;
function ok(cond, label) { n++; if (!cond) { bad++; console.error('  ✗', label); } else console.log('  ✓', label); }

/* 1) 키 없이 교사 액션 → 거절 */
ok(GET({ action: 'assignList' }).error === 'unauthorized', '키 없는 assignList 거절');

/* 2) 배정 추가 3건 (학년/학교/개인) */
let r1 = GET({ ...KEY, action: 'assignAdd', ttype: '학년', target: '고1', cat: 'pho', catLabel: '음운', round: '1' });
ok(r1.ok === true && r1.kind === 'assign', '학년 배정 추가');
let r2 = GET({ ...KEY, action: 'assignAdd', ttype: '학교', target: '화정고', cat: 'pho', catLabel: '음운', round: '2', memo: '9/5까지' });
ok(r2.ok === true, '학교 배정 추가');
let r3 = GET({ ...KEY, action: 'assignAdd', ttype: '개인', target: '홍길동', cat: 'mor', catLabel: '형태소', round: '1' });
ok(r3.ok === true, '개인 배정 추가');
ok(GET({ ...KEY, action: 'assignAdd', ttype: '반', target: 'x', cat: 'pho', round: '1' }).error === 'bad_ttype', '잘못된 대상구분 거절');
ok(GET({ ...KEY, action: 'assignAdd', ttype: '학년', target: '', cat: 'pho', round: '1' }).error === 'missing', '빈 대상 거절');

/* 3) 목록 */
let list = GET({ ...KEY, action: 'assignList' });
ok(list.kind === 'assign' && list.rows.length === 3, '배정 목록 3건');
ok(list.rows[0].status === '진행', '기본 상태 진행');

/* 4) 학생 조회 매칭 */
let m1 = GET({ action: 'myAssign', grade: '고1', school: '능곡고', name: '김철수' });
ok(m1.ok === true && m1.kind === 'assign', 'myAssign 키 없이 허용');
ok(m1.items.length === 1 && m1.items[0].cat === 'pho' && m1.items[0].round === '1', '학년 매칭 (고1 → pho-1)');
let m2 = GET({ action: 'myAssign', grade: '고2', school: '화정고등학교', name: '김철수' });
ok(m2.items.length === 1 && m2.items[0].round === '2', '학교 매칭 (화정고 ↔ 화정고등학교)');
let m3 = GET({ action: 'myAssign', grade: '중2', school: '서정중', name: '홍 길동' });
ok(m3.items.length === 1 && m3.items[0].cat === 'mor', '개인 매칭 (공백 무시)');
let m4 = GET({ action: 'myAssign', grade: '고3', school: '백양고', name: '아무개' });
ok(m4.items.length === 0, '해당 없는 학생 = 빈 목록');
/* 학교 이름이 다른 학교의 접두어가 아니어야 함 — "화수고"는 "화정고"와 다름 */
let m5 = GET({ action: 'myAssign', grade: '', school: '화수고', name: '' });
ok(m5.items.length === 0, '다른 학교(화수고)는 화정고 배정에 안 걸림');

/* 5) 상태 변경 — 마감하면 학생 조회에서 빠짐 */
let rows = GET({ ...KEY, action: 'assignList' }).rows;
let target = rows.find(r => r.ttype === '학년');
ok(GET({ ...KEY, action: 'assignSet', row: target._row, time: target.time, status: '마감' }).ok === true, '마감 처리');
ok(GET({ action: 'myAssign', grade: '고1', school: '', name: '' }).items.length === 0, '마감된 배정은 학생에게 안 보임');
ok(GET({ ...KEY, action: 'assignSet', row: target._row, time: target.time, status: '진행' }).ok === true, '다시 열기');
ok(GET({ action: 'myAssign', grade: '고1', school: '', name: '' }).items.length === 1, '다시 열면 보임');

/* 6) time 대조 — 어긋나면 stale */
ok(GET({ ...KEY, action: 'assignSet', row: target._row, time: '2000-01-01 00:00:00', status: '마감' }).error === 'stale', '기록일시 어긋나면 거절');
ok(GET({ ...KEY, action: 'assignDel', row: 999, time: 'x' }).error === 'stale', '없는 행 삭제 거절');

/* 7) 삭제 — 행 밀림 뒤 옛 row로 접근하면 stale */
rows = GET({ ...KEY, action: 'assignList' }).rows;
const first = rows[0], second = rows[1];
ok(GET({ ...KEY, action: 'assignDel', row: first._row, time: first.time }).ok === true, '삭제');
ok(GET({ ...KEY, action: 'assignList' }).rows.length === 2, '삭제 후 2건');
/* second는 이제 한 줄 위로 밀렸다 — 옛 row 번호로 지우려 하면 time 불일치로 거절돼야 함
 * (단, 옛 row 자리에 우연히 다른 행이 오면 그 행의 time과 다르므로 안전) */
let stale = GET({ ...KEY, action: 'assignDel', row: second._row, time: 'wrong-time' });
ok(stale.error === 'stale', '밀린 행 옛 번호+틀린 time 거절');

/* 8) 결과 수집(doPost)은 그대로 동작 — 새 test.html payload */
let post = doPost({ postData: { contents: JSON.stringify({ time: '2026-08-28 21:00', name: '테스트', school: '화정고', grade: '고1', unit: '음운', round: '1', score: '1 / 42', details: '1. ✓' }) } });
ok(JSON.parse(post._s).ok === true, 'doPost 결과 저장');
let res = GET({ ...KEY });
ok(res.rows && res.rows.length === 1 && res.rows[0].unit === '음운', '결과 목록에 저장 확인');

console.log(bad ? `\n실패 ${bad}/${n}` : `\n전체 통과 (${n}건)`);
process.exit(bad ? 1 : 0);
