/* 브라우저 E2E — 정적 서빙 + script.google.com 가로채기로
 * test.html(응시·채점·배정 게이트·제출 payload) / index.html(배정 목록) /
 * shueguk-teacher-dashboard.html(배정 CRUD·결과 표)을 검사한다.
 *   실행: node tools/e2e-test.js   (Playwright + 내장 크로미움)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 8931;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

let n = 0, bad = 0;
function ok(cond, label) { n++; if (!cond) { bad++; console.error('  ✗', label); } else console.log('  ✓', label); }

(async () => {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    res.end(fs.readFileSync(f));
  }).listen(PORT);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();

  // ===== 가짜 백엔드 상태 =====
  let assignItems = [];          // myAssign 응답 items
  let assignRows = [];           // assignList 응답 rows
  let lastPost = null;           // doPost로 보낸 payload
  const reqLog = [];             // 배정 액션 호출 기록

  await ctx.route('**://script.google.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const q = Object.fromEntries(url.searchParams);
    if (req.method() === 'POST') {
      lastPost = JSON.parse(req.postData());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    const action = q.action || '';
    reqLog.push(q);
    let payload;
    if (action === 'myAssign') payload = { ok: true, kind: 'assign', items: assignItems };
    else if (action === 'assignList') payload = { ok: true, kind: 'assign', rows: assignRows };
    else if (action === 'assignAdd') {
      assignRows.push({ time: '2026-08-28 21:00:00', ttype: q.ttype, target: q.target, cat: q.cat, catLabel: q.catLabel, round: q.round, memo: q.memo || '', status: '진행', _row: assignRows.length + 2 });
      payload = { ok: true, kind: 'assign' };
    }
    else if (action === 'assignSet') { assignRows.forEach(r => { if ('' + r._row === q.row) r.status = q.status; }); payload = { ok: true, kind: 'assign' }; }
    else if (action === 'assignDel') { assignRows = assignRows.filter(r => '' + r._row !== q.row); payload = { ok: true, kind: 'assign' }; }
    else payload = { ok: true, rows: [{ time: '2026-08-27 20:00', name: '김결과', school: '화정고', grade: '고1', unit: '음운', round: '1', score: '40 / 42', details: '1. ✓', _row: 2, _sig: 'aa' }] };
    const body = q.callback ? `${q.callback}(${JSON.stringify(payload)})` : JSON.stringify(payload);
    return route.fulfill({ status: 200, contentType: q.callback ? 'text/javascript' : 'application/json', body });
  });

  /* ========== 1) test.html — 렌더·개념·게이트 차단 ========== */
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });

  await page.goto(`http://localhost:${PORT}/test.html?c=pho&r=1&name=박검증&school=화정고&grade=고1`);
  await page.waitForSelector('#app:not(.hidden)');
  ok((await page.textContent('#h-round')).includes('음운 1회'), '헤더에 카테고리·회차 표시');
  ok((await page.$$('.cat-label')).length === 3, '개념 정리 탭 3개(교체/탈락/첨가·기타)');
  ok((await page.$$('#cat-0 .vocab-card')).length === 6, '교체 탭 개념 카드 6장');
  await page.click('#tab-test');
  ok((await page.$$('.q-card')).length === 42, '문항 42개 렌더');
  ok(await page.inputValue('#si-name') === '박검증', '학생 정보 미리 채움');
  ok(await page.inputValue('#si-grade') === '고1', '학년 미리 선택');

  // 1번 문항 정답 입력 → 진행 카운트
  await page.selectOption('#sel-0-0', '비음화');
  await page.fill('#frm-0-0', '종노');
  await page.waitForFunction(() => document.getElementById('filled-count').textContent === '1');
  ok(true, '진행 카운트 1 (과정형 완료 판정)');

  // 배정 없음 → 제출 차단
  assignItems = [{ cat: 'pho', round: '2' }];   // 다른 회차만 배정
  await page.click('#submit-btn');
  await page.waitForFunction(() => document.getElementById('submit-btn').textContent === '전체 제출');
  ok(dialogs.some(m => m.includes('배정된 테스트가 아니에요')), '미배정 제출 차단 안내');
  ok(!(await page.$('.final.show')), '차단 시 채점 안 됨');

  /* ========== 2) test.html — 게이트 통과·채점·payload ========== */
  assignItems = [{ cat: 'pho', round: '1' }];
  await page.click('#submit-btn');
  await page.waitForSelector('.final.show');
  ok((await page.textContent('#final .score-big')) === '1', '점수 1점(1번만 정답)');
  ok((await page.$$('.q-card.correct')).length === 1 && (await page.$$('.q-card.wrong')).length === 41, '카드 정오 표시');
  const fb = await page.textContent('#feedback-1');
  ok(fb.includes('정답 과정') && fb.includes('잡히다'), '오답 문항에 정답 과정 표시');
  await page.waitForFunction(() => true);
  ok(lastPost && lastPost.unit === '음운' && '' + lastPost.round === '1' && lastPost.score === '1 / 42' && lastPost.name === '박검증', '제출 payload (unit=음운, round=1, score=1/42)');
  ok(lastPost.details.split('\n')[0] === '1. ✓', '상세 첫 줄 1. ✓');

  /* ========== 3) test.html — preview는 게이트 생략 ========== */
  const prevReqs = reqLog.length;
  const p2 = await ctx.newPage();
  p2.on('dialog', d => d.accept());
  await p2.goto(`http://localhost:${PORT}/test.html?c=pho&r=5&preview=1`);
  await p2.waitForSelector('#app:not(.hidden)');
  await p2.click('#tab-test');
  await p2.fill('#si-name', '미리보기'); await p2.fill('#si-school', '슈국'); await p2.selectOption('#si-grade', '고2');
  await p2.click('#submit-btn');
  await p2.waitForSelector('.final.show');
  ok(!reqLog.slice(prevReqs).some(q => q.action === 'myAssign'), 'preview=1 은 배정 확인 생략');
  await p2.close();

  /* ========== 4) 미등록 테스트 안내 ========== */
  const p3 = await ctx.newPage();
  await p3.goto(`http://localhost:${PORT}/test.html?c=mor&r=1`);
  await p3.waitForSelector('.loading-msg.fail');
  ok((await p3.textContent('.loading-msg.fail')).includes('아직 등록되지 않은'), '미등록 테스트(형태소 1회) 안내');
  await p3.close();

  /* ========== 5) index.html — 배정 목록 ========== */
  assignItems = [{ cat: 'pho', round: '3', catLabel: '음운', memo: '9/5까지' }, { cat: 'mor', round: '1', catLabel: '형태소' }];
  const p4 = await ctx.newPage();
  p4.on('dialog', d => d.accept());
  await p4.goto(`http://localhost:${PORT}/index.html`);
  await p4.fill('#si-name', '박검증'); await p4.fill('#si-school', '화정고'); await p4.selectOption('#si-grade', '고1');
  await p4.click('#check-btn');
  await p4.waitForSelector('.assign-card');
  const cards = await p4.$$('.assign-card');
  ok(cards.length === 2, '배정 카드 2장');
  ok((await p4.textContent('.assign-card .assign-title')).includes('음운 3회'), '카드에 카테고리·회차·제목');
  const href = await p4.getAttribute('.assign-card .assign-go', 'href');
  ok(href.includes('test.html?c=pho&r=3') && href.includes('name=') && decodeURIComponent(href).includes('박검증'), '응시 링크에 학생 정보 전달');
  // 배정 없음 안내
  assignItems = [];
  await p4.click('#check-btn');
  await p4.waitForFunction(() => document.getElementById('status').textContent.includes('배정된 문법 테스트가 없어요'));
  ok(true, '배정 없음 안내');
  await p4.close();

  /* ========== 6) 결과 확인(대시보드) — 결과 전용 ========== */
  const p5 = await ctx.newPage();
  await p5.goto(`http://localhost:${PORT}/shueguk-teacher-dashboard.html`);
  await p5.waitForSelector('#tbody tr');
  ok((await p5.textContent('#tbody')).includes('김결과'), '결과 표 표시');
  ok((await p5.textContent('#f-unit')).includes('음운'), '단원 필터에 카테고리');
  ok(!(await p5.$('#a-tbody')), '대시보드에 배정 UI 없음 (배정하기 페이지로 이동)');
  await p5.close();

  /* ========== 7) 배정하기 페이지 — 회차 목록·배정 CRUD ========== */
  assignRows = [{ time: '2026-08-28 20:00:00', ttype: '학년', target: '고1', cat: 'pho', catLabel: '음운', round: '1', memo: '', status: '진행', _row: 2 }];
  const p7 = await ctx.newPage();
  p7.on('dialog', d => d.accept());
  await p7.goto(`http://localhost:${PORT}/assign.html`);
  await p7.waitForSelector('#a-tbody tr');
  ok((await p7.textContent('#a-tbody')).includes('학년') && (await p7.textContent('#a-tbody')).includes('음운 1회'), '배정 현황 표시');
  ok((await p7.$$('.cat-card')).length === 10, '카테고리 카드 10개');
  ok((await p7.$$('.cat-card[disabled]')).length === 8, '문항 없는 카테고리 8개는 비활성(준비 중)');
  ok(!(await p7.$('#round-view:not(.hidden)')), '첫 화면에는 회차 목록 없음');
  // 음운 → 회차 10개 → 뒤로 → 한글 맞춤법 → 32개
  await p7.click('.cat-card[data-code="pho"]');
  await p7.waitForSelector('#round-view:not(.hidden)');
  ok((await p7.$$('#rounds .row')).length === 10, '음운 회차 10개');
  await p7.click('#cat-back');
  await p7.waitForSelector('#home-view:not(.hidden)');
  await p7.click('.cat-card[data-code="ort"]');
  await p7.waitForFunction(() => document.querySelectorAll('#rounds .row').length === 32);
  ok(true, '한글 맞춤법 회차 32개');
  // 미리보기 링크에 preview=1
  const prevHref = await p7.getAttribute('#rounds .row .abtn.preview', 'href');
  ok(prevHref.includes('test.html?c=ort&r=1') && prevHref.includes('preview=1'), '미리보기 링크');
  // [배정] → 폼 → 학교 대상 저장
  await p7.click('#rounds .row .abtn.assign');
  await p7.waitForSelector('#form-card.show');
  ok((await p7.textContent('#f-title')).includes('한글 맞춤법 1회'), '배정 폼에 회차 표시');
  await p7.selectOption('#f-ttype', '학교');
  await p7.fill('#f-text', '능곡고');
  await p7.click('#f-add');
  await p7.waitForFunction(() => document.querySelectorAll('#a-tbody tr').length === 2);
  const addReq = reqLog.find(q => q.action === 'assignAdd');
  ok(addReq && addReq.ttype === '학교' && addReq.target === '능곡고' && addReq.cat === 'ort' && addReq.round === '1', 'assignAdd 파라미터');
  ok((await p7.textContent('#a-tbody')).includes('능곡고'), '추가된 배정 표시');
  // 마감 → 삭제
  await p7.click('#a-tbody .a-toggle');
  await p7.waitForFunction(() => document.getElementById('a-tbody').textContent.includes('마감'));
  ok(reqLog.some(q => q.action === 'assignSet' && q.status === '마감'), '마감 요청');
  await p7.click('#a-tbody .a-del');
  await p7.waitForFunction(() => document.querySelectorAll('#a-tbody tr').length === 1);
  ok(reqLog.some(q => q.action === 'assignDel'), '삭제 요청·목록 갱신');
  await p7.close();

  /* ========== 8) 배정하기 — 옛 배포본(assign 미지원) 안내 ========== */
  const p6 = await ctx.newPage();
  await p6.route('**://script.google.com/**', async (route) => {
    const q = Object.fromEntries(new URL(route.request().url()).searchParams);
    const payload = { ok: true, rows: [] };  // 옛 배포본은 assignList에도 결과 rows를 돌려준다
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: `${q.callback}(${JSON.stringify(payload)})` });
  });
  await p6.goto(`http://localhost:${PORT}/assign.html`);
  await p6.waitForFunction(() => document.getElementById('a-status').textContent.includes('재배포'));
  ok(true, '옛 배포본이면 재배포 안내');
  await p6.close();

  /* ========== 9) 한글 맞춤법 개념 정리 탭 ========== */
  const p8 = await ctx.newPage();
  await p8.goto(`http://localhost:${PORT}/test.html?c=ort&r=2&preview=1`);
  await p8.waitForSelector('#app:not(.hidden)');
  ok(!(await p8.$eval('#mode-tabs', el => el.classList.contains('hidden'))), '개념 정리/테스트 모드 탭 표시');
  ok((await p8.textContent('#study-body')).includes('된소리로 적는다'), '개념 정리에 규정 내용');
  ok((await p8.$$('#study-body .note-box')).length >= 1, "'다만' 안내 상자 표시");
  await p8.close();

  await browser.close();
  server.close();
  console.log(bad ? `\n실패 ${bad}/${n}` : `\n전체 통과 (${n}건)`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
