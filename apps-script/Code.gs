/***************************************************************
 * 슈국 문법 테스트 — 결과 수집/조회/삭제 Apps Script (참고용)
 * ------------------------------------------------------------
 *  - doPost : 학생 페이지(shueguk-phonology-N-student.html)가 보낸
 *             결과를 시트에 저장 (헤더 이름 기준 → 칼럼 순서 무관)
 *  - doGet  : 교사 대시보드가 JSONP로 조회 / 삭제(action=delete)
 *
 *  ▶ 설치 / 갱신
 *    1) 문법 결과 시트 → [확장 프로그램 → Apps Script]
 *    2) Code.gs 에 이 내용을 붙여넣고 저장(Ctrl+S)
 *       ※ 기존 스크립트가 있다면 doPost 동작(저장 항목)이 같은지 확인 후 교체하세요.
 *    3) [배포 → 배포 관리 → ✏️ → 버전: 새 버전 → 배포]  (주소 유지)
 *    4) 액세스 권한: "모든 사용자"
 *    ※ 삭제 기능을 쓰려면 이 새 버전으로 "반드시" 재배포해야 합니다.
 ***************************************************************/

var ACCESS_KEY = 'shueguk2026';   // 대시보드와 동일하게 유지
var SHEET_NAME = '';              // 결과 시트 이름. 비워두면 첫 번째 시트를 사용
var HEADERS = ['time', 'name', 'school', 'grade', 'unit', 'round', 'score', 'details'];

/* 결과 시트 가져오기 (완전히 빈 시트면 헤더 생성) */
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : null;
  if (!sh) sh = ss.getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  return sh;
}

/* 헤더 행을 읽어 { 표준키: 0-based 열번호 } 로 변환 */
function headerMap_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return {};
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < hdr.length; i++) {
    var k = canon_(hdr[i]);
    if (k && map[k] === undefined) map[k] = i;
  }
  return map;
}

/* 학생 제출 (학생 페이지 → fetch POST) — 헤더 이름에 맞춰 저장 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sh = getSheet_();
    var map = headerMap_(sh);
    HEADERS.forEach(function (h) {
      if (map[h] === undefined) {
        var col = sh.getLastColumn() + 1;
        sh.getRange(1, col).setValue(h);
        map[h] = col - 1;
      }
    });
    var width = sh.getLastColumn();
    var row = [];
    for (var i = 0; i < width; i++) row.push('');
    HEADERS.forEach(function (h) { row[map[h]] = (data[h] != null ? data[h] : ''); });
    sh.appendRow(row);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* 교사 대시보드 (JSONP GET) — 조회 / 삭제 / 배정 관리
 * myAssign 만 학생 공개(키 불필요), 나머지는 ACCESS_KEY 필요. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var cb = p.callback || '';
  var payload;
  if (p.action === 'myAssign') {
    payload = myAssign_(p);
  } else if (p.key !== ACCESS_KEY) {
    payload = { ok: false, error: 'unauthorized' };
  } else if (p.action === 'delete') {
    payload = deleteRows_(p.ids || '');
  } else if (p.action === 'assignList') {
    payload = assignList_();
  } else if (p.action === 'assignAdd') {
    payload = assignAdd_(p);
  } else if (p.action === 'assignSet') {
    payload = assignSet_(p);
  } else if (p.action === 'assignDel') {
    payload = assignDel_(p);
  } else {
    payload = { ok: true, rows: readRows_() };
  }
  var out = JSON.stringify(payload);
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + out + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(out)
    .setMimeType(ContentService.MimeType.JSON);
}

/* 시트 → 행 객체 배열. 각 행에 시트 행번호(_row)와 내용 해시(_sig) 동봉. */
function readRows_() {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var keys = values[0].map(canon_);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var j = 0; j < keys.length; j++) obj[keys[j] || ('col' + j)] = values[i][j];
    obj._row = i + 1;
    obj._sig = rowSig_(values[i]);
    rows.push(obj);
  }
  return rows;
}

/* 선택 행 삭제. ids = "행번호:해시,..." (해시 일치 시에만 삭제, 내림차순) */
function deleteRows_(idsStr) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'busy' }; }
  try {
    var sh = getSheet_();
    var values = sh.getDataRange().getValues();
    var want = {};
    ('' + idsStr).split(',').forEach(function (tok) {
      tok = tok.trim(); if (!tok) return;
      var idx = tok.indexOf(':');
      var rn = parseInt(idx >= 0 ? tok.slice(0, idx) : tok, 10);
      if (rn >= 2) want[rn] = idx >= 0 ? tok.slice(idx + 1) : '';
    });
    var nums = Object.keys(want).map(Number).sort(function (a, b) { return b - a; });
    var deleted = 0, skipped = 0;
    nums.forEach(function (rn) {
      if (rn > values.length) { skipped++; return; }
      if (rowSig_(values[rn - 1]) === want[rn]) { sh.deleteRow(rn); deleted++; }
      else skipped++;
    });
    return { ok: true, deleted: deleted, skipped: skipped };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

/***************************************************************
 * 배정 — 학년 / 학교 / 개인에게 테스트 지정 ('배정' 탭)
 *  A:기록일시 B:대상구분(학년|학교|개인) C:대상 D:카테고리코드
 *  E:카테고리 F:회차 G:메모 H:상태(진행|마감)
 *  - 교사(키 필요): assignList / assignAdd / assignSet / assignDel
 *  - 학생(공개):   myAssign&grade=&school=&name= → 상태 '진행'인
 *                  배정 중 그 학생에게 해당하는 것만 반환
 ***************************************************************/
var ASSIGN_SHEET = '배정';
var ASSIGN_HEADERS = ['기록일시', '대상구분', '대상', '카테고리코드', '카테고리', '회차', '메모', '상태'];

function assignSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ASSIGN_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ASSIGN_SHEET);
    sh.appendRow(ASSIGN_HEADERS);
    // 기록일시·회차가 날짜/숫자로 자동 변환되지 않게 텍스트 강제
    sh.getRange(1, 1, sh.getMaxRows(), ASSIGN_HEADERS.length).setNumberFormat('@');
  }
  if (sh.getLastRow() === 0) sh.appendRow(ASSIGN_HEADERS);
  return sh;
}

function assignRows_() {
  var sh = assignSheet_();
  var values = sh.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var v = values[i];
    rows.push({
      time: txt_(v[0]), ttype: txt_(v[1]), target: txt_(v[2]),
      cat: txt_(v[3]), catLabel: txt_(v[4]), round: txt_(v[5]),
      memo: txt_(v[6]), status: txt_(v[7]) || '진행', _row: i + 1
    });
  }
  return rows;
}

function assignList_() {
  return { ok: true, kind: 'assign', rows: assignRows_() };
}

function assignAdd_(p) {
  var ttype = txt_(p.ttype), target = txt_(p.target);
  var cat = txt_(p.cat), catLabel = txt_(p.catLabel), round = txt_(p.round);
  if (['학년', '학교', '개인'].indexOf(ttype) < 0) return { ok: false, error: 'bad_ttype' };
  if (!target || !cat || !round) return { ok: false, error: 'missing' };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'busy' }; }
  try {
    var sh = assignSheet_();
    var ts = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    var row = [ts, ttype, target, cat, catLabel, round, txt_(p.memo), '진행'];
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    return { ok: true, kind: 'assign', time: ts };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

/* 상태 변경 (진행↔마감). row + time(기록일시)을 대조해 행이 밀렸으면 거절. */
function assignSet_(p) {
  var status = txt_(p.status);
  if (['진행', '마감'].indexOf(status) < 0) return { ok: false, error: 'bad_status' };
  return assignTouch_(p, function(sh, rn) {
    sh.getRange(rn, 8).setNumberFormat('@').setValue(status);
  });
}

function assignDel_(p) {
  return assignTouch_(p, function(sh, rn) { sh.deleteRow(rn); });
}

function assignTouch_(p, fn) {
  var rn = parseInt(p.row, 10);
  if (!(rn >= 2)) return { ok: false, error: 'bad_row' };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'busy' }; }
  try {
    var sh = assignSheet_();
    if (rn > sh.getLastRow()) return { ok: false, error: 'stale' };
    var ts = txt_(sh.getRange(rn, 1).getValue());
    if (ts !== txt_(p.time)) return { ok: false, error: 'stale' };
    fn(sh, rn);
    return { ok: true, kind: 'assign' };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

/* 학생 조회 — 상태 '진행'인 배정 중 이 학생에게 해당하는 것만.
 *  학년: 대상 == 학생 학년 / 개인: 이름 일치(공백 제거)
 *  학교: 표기가 다를 수 있어("화정고"·"화정고등학교") 한쪽이 다른 쪽을 포함하면 인정 */
function myAssign_(p) {
  var grade = squeeze_(p.grade), school = squeeze_(p.school), name = squeeze_(p.name);
  var items = assignRows_().filter(function(r) {
    if (r.status !== '진행') return false;
    var t = squeeze_(r.target);
    if (r.ttype === '학년') return !!grade && t === grade;
    if (r.ttype === '개인') return !!name && t === name;
    if (r.ttype === '학교') {
      if (!school || !t) return false;
      return t === school || t.indexOf(school) === 0 || school.indexOf(t) === 0;
    }
    return false;
  }).map(function(r) {
    return { cat: r.cat, catLabel: r.catLabel, round: r.round, ttype: r.ttype, memo: r.memo, time: r.time };
  });
  return { ok: true, kind: 'assign', items: items };
}

function txt_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  }
  return ('' + (v == null ? '' : v)).trim();
}
function squeeze_(v) { return ('' + (v == null ? '' : v)).replace(/\s/g, ''); }

/* 행 내용 해시 (MD5 앞 10자리) — Date는 epoch ms 로 정규화 */
function rowSig_(vals) {
  var s = vals.map(function (v) {
    if (Object.prototype.toString.call(v) === '[object Date]') return v.getTime();
    return '' + v;
  }).join('');
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < raw.length; i++) { var b = (raw[i] + 256) % 256; hex += ('0' + b.toString(16)).slice(-2); }
  return hex.slice(0, 10);
}

/* 헤더 이름 표준화 (한글/영문 모두 허용) */
function canon_(h) {
  h = ('' + h).trim().toLowerCase();
  var map = {
    'time': 'time', '시각': 'time', '제출시각': 'time', 'timestamp': 'time', '타임스탬프': 'time',
    'name': 'name', '이름': 'name',
    'school': 'school', '학교': 'school',
    'grade': 'grade', '학년': 'grade',
    'unit': 'unit', '단원': 'unit',
    'round': 'round', '회차': 'round', '주차': 'round',
    'score': 'score', '점수': 'score',
    'details': 'details', '상세': 'details'
  };
  return map[h] || h;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
