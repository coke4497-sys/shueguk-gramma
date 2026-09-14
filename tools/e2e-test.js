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
  const ROSTER = [               // 리포트 roster (공용 학생 선택 위젯이 읽음)
    { name: '박보검', school: '화정고', grade: '고1', teacher: '수경T' },
    { name: '김철수', school: '능곡고', grade: '고1', teacher: '수경T' },
    { name: '김결과', school: '화정고', grade: '고1', teacher: '수경T' },
    { name: '이영희', school: '서정중', grade: '중2', teacher: '수경T' }
  ];

  // 공용 학생 선택 위젯(리포트 저장소 GitHub Pages)을 로컬 파일로 서빙
  const REPORT_DIR = path.join(ROOT, '..', 'shueguk-report');
  await ctx.route('**://coke4497-sys.github.io/shueguk-report/**', async (route) => {
    const base = path.basename(new URL(route.request().url()).pathname);
    const f = path.join(REPORT_DIR, base);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: base.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(f, 'utf8') });
  });

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
    if (action === 'roster') payload = { result: 'success', students: ROSTER };   // 리포트 백엔드 명단
    else if (action === 'myAssign') payload = { ok: true, kind: 'assign', items: assignItems };
    else if (action === 'assignList') payload = { ok: true, kind: 'assign', rows: assignRows };
    else if (action === 'assignAdd') {
      assignRows.push({ time: '2026-08-28 21:00:00', ttype: q.ttype, target: q.target, cat: q.cat, catLabel: q.catLabel, round: q.round, memo: q.memo || '', status: '진행', due: q.due || '', _row: assignRows.length + 2 });
      payload = { ok: true, kind: 'assign' };
    }
    else if (action === 'assignSet') { assignRows.forEach(r => { if ('' + r._row === q.row) r.status = q.status; }); payload = { ok: true, kind: 'assign' }; }
    else if (action === 'assignDel') { assignRows = assignRows.filter(r => '' + r._row !== q.row); payload = { ok: true, kind: 'assign' }; }
    else payload = { ok: true, rows: [{ time: '2026-08-27 20:00', name: '김결과', school: '화정고', grade: '고1', unit: '음운', round: '1', score: '40 / 42', details: '1. ✓', _row: 2, _sig: 'aa' }] };
    const body = q.callback ? `${q.callback}(${JSON.stringify(payload)})` : JSON.stringify(payload);
    return route.fulfill({ status: 200, contentType: q.callback ? 'text/javascript' : 'application/json', body });
  });

  // 슈퍼스타 별 적립 — 수파베이스 함수 호출 가로채기(gramma_submit / gramma_status)
  const sbCalls = [];
  let starStatusItems = [];
  await ctx.route(/bangdbhqpphqqdwcledg\.supabase\.co\/rest\/v1\/rpc\/(gramma_submit|gramma_status)/, route => {
    const fn = route.request().url().split('/rpc/')[1];
    const body = JSON.parse(route.request().postData() || '{}').p || {};
    sbCalls.push({ fn, body });
    if (fn === 'gramma_submit') {
      const pct = Math.round(body.got * 100 / body.total);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, pct, star: pct >= 90, first: pct >= 90 && body.round !== '5' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items: starStatusItems }) });
  });

  /* ========== 1) test.html — 렌더·개념·게이트 차단 ========== */
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });

  await page.goto(`http://localhost:${PORT}/test.html?c=pho&r=1&name=박검증&school=화정고&grade=고1&p8=12345678`);
  await page.waitForSelector('#app:not(.hidden)');
  ok((await page.textContent('#h-round')).includes('음운 1회'), '헤더에 카테고리·회차 표시');
  ok((await page.$$('.cat-label')).length === 3, '개념 정리 탭 3개(교체/탈락/첨가·기타)');
  ok((await page.$$('#cat-0 .vocab-card')).length === 6, '교체 탭 개념 카드 6장');
  await page.click('#tab-test');
  ok((await page.$$('.q-card')).length === 21, '문항 21개 렌더 (10회차 → 20회차로 나눔)');
  ok(await page.inputValue('#si-name') === '박검증', '학생 정보 미리 채움');
  ok(await page.inputValue('#si-grade') === '고1', '학년 미리 선택');
  ok(await page.inputValue('#si-phone8') === '12345678', '학부모 전화 8자리 미리 채움');
  ok(await page.$eval('#student-info', el => el.classList.contains('collapsed')), '학생 정보 카드는 기본 접힘(요약 한 줄)');
  ok((await page.textContent('#si-sum-text')).replace(/\s/g,'') === '박검증·고1·12345678', "요약 줄 '이름 · 학년 · 전화번호'");
  ok(await page.$eval('#topbar', el => getComputedStyle(el).position === 'sticky'), '상단 영역 고정(sticky)');
  ok(await page.$eval('#tb-row2', el => !el.classList.contains('hidden')), '테스트 모드에서 완료·진행바·제출 줄 표시');
  ok((await page.$$('#card-0 .step-row')).length === 1 && !(await page.$('#card-0 .step-add')), '과정형 문항은 정답 단계 수만큼 줄(1단계 = 1줄), [+] 없음');
  ok((await page.$$('#card-3 .step-row')).length === 2 && !(await page.$('#card-3 .step-del')), '2단계 문항은 2줄이 미리 있음(단계 수 힌트)');
  ok(await page.getAttribute('#frm-3-0', 'placeholder') === '바뀐 형태' && await page.getAttribute('#frm-3-1', 'placeholder') === '최종 발음', '마지막 줄만 최종 발음 placeholder');

  // 1번 문항 정답 입력 → 진행 카운트
  await page.selectOption('#sel-0-0', '비음화');
  await page.fill('#frm-0-0', '종노');
  await page.waitForFunction(() => document.getElementById('filled-count').textContent === '1');
  ok(true, '진행 카운트 1 (과정형 완료 판정)');
  ok(await page.$eval('#card-0', el => el.classList.contains('filled')) && await page.$eval('#frm-0-0', el => el.classList.contains('has')), '답을 채운 문항 카드·입력칸 강조');

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
  ok((await page.$$('.q-card.correct')).length === 1 && (await page.$$('.q-card.wrong')).length === 20, '카드 정오 표시');
  const fb = await page.textContent('#feedback-1');
  ok(fb.includes('정답 과정') && fb.includes('잡히다'), '오답 문항에 정답 과정 표시');
  // 오답 해설 — 판정 줄 / 과정 칩 / 규칙 칩이 층으로 나뉘어 있다
  ok((await page.$$('#feedback-1 .fb-top')).length === 1, '오답 해설에 판정 줄');
  ok((await page.$$('#feedback-1 .fb-chain .ch-r')).length >= 1, '정답 과정이 변동 종류 칩으로 표시');
  ok(await page.$eval('#feedback-1 .fb-chain .ch-f.fin', el => el.textContent.includes('[')), '최종 발음 칩 강조');
  // 틀린 문항만 보기
  await page.click('#review-btn');
  await page.waitForFunction(() => document.body.classList.contains('only-wrong'));
  ok(await page.$eval('#card-0', el => getComputedStyle(el).display === 'none'), '틀린 문항만 보기 — 맞힌 문항 숨김');
  await page.click('#review-btn');
  ok(!(await page.$eval('body', el => el.classList.contains('only-wrong'))), '다시 누르면 전체 문항 복귀');
  await page.waitForFunction(() => true);
  ok(lastPost && lastPost.unit === '음운' && '' + lastPost.round === '1' && lastPost.score === '1 / 21' && lastPost.name === '박검증' && lastPost.phone8 === '12345678', '제출 payload (unit·round·score·phone8)');
  ok(lastPost.details.split('\n')[0] === '1. ✓', '상세 첫 줄 1. ✓');
  // 별 적립 — 1/21(5%)은 별 없음 안내, 수파베이스 기록은 시트 전송과 함께
  ok((await page.textContent('#star-box')).includes('5%') && (await page.textContent('#star-box')).includes('90% 이상이면'), '정답률 5% → 별 없음 안내');
  const sub1 = sbCalls.find(c => c.fn === 'gramma_submit');
  ok(sub1 && sub1.body.name === '박검증' && sub1.body.phone8 === '12345678' && sub1.body.unit === '음운' && sub1.body.round === '1' && sub1.body.got === 1 && sub1.body.total === 21, 'gramma_submit 호출(이름·8자리·카테고리·회차·점수)');

  /* ========== 3) test.html — preview는 게이트 생략 ========== */
  const prevReqs = reqLog.length;
  const p2 = await ctx.newPage();
  p2.on('dialog', d => d.accept());
  await p2.goto(`http://localhost:${PORT}/test.html?c=pho&r=5&preview=1`);
  await p2.waitForSelector('#app:not(.hidden)');
  await p2.click('#tab-test');
  ok(await p2.$eval('#student-info', el => el.classList.contains('collapsed')), '정보 없이 열어도 카드는 접힘');
  ok((await p2.textContent('#si-sum-text')).includes('이름 미입력') && (await p2.textContent('#si-sum-text')).includes('학년 미선택'), "빈 항목은 '이름 미입력 · 학년 미선택'으로");
  await p2.click('#student-info');
  ok(await p2.$eval('#student-info', el => el.classList.contains('open')) && (await p2.textContent('#si-edit')) === '접기', "카드를 누르면 펼쳐지고 오른쪽 글씨 '접기'");
  await p2.fill('#si-name', '미리보기'); await p2.fill('#si-school', '슈국'); await p2.selectOption('#si-grade', '고2'); await p2.fill('#si-phone8', '87654321');
  await p2.click('#submit-btn');
  await p2.waitForSelector('.final.show');
  ok(!reqLog.slice(prevReqs).some(q => q.action === 'myAssign'), 'preview=1 은 배정 확인 생략');
  ok(!(await p2.$('#star-box')) && !sbCalls.some(c => c.fn === 'gramma_submit' && c.body.name === '미리보기'), 'preview 는 별 기록·안내 없음');
  await p2.close();
  /* ========== 3b) 90% 이상 → 별 +1 안내 + 수파베이스 기록 ========== */
  const p2b = await ctx.newPage(); p2b.on('dialog', d => d.accept());
  assignItems = [{ cat: 'pho', round: '1' }];
  await p2b.goto(`http://localhost:${PORT}/test.html?c=pho&r=1&name=박검증&school=화정고&grade=고1&p8=12345678`);
  await p2b.waitForSelector('#app:not(.hidden)'); await p2b.click('#tab-test');
  // 21문항 전부 정답으로 채움(데이터의 정답을 그대로 넣는다)
  const answers = await p2b.evaluate(() => fetch('data/pho-1.json').then(r => r.json()).then(d => d.questions.map(q => q.steps.map(st => [st.accept[0], st.form.split('/')[0]]))));
  for (let i = 0; i < answers.length; i++) for (let k = 0; k < answers[i].length; k++) { await p2b.selectOption(`#sel-${i}-${k}`, answers[i][k][0]); await p2b.fill(`#frm-${i}-${k}`, answers[i][k][1]); }
  await p2b.click('#submit-btn'); await p2b.waitForSelector('.final.show');
  ok((await p2b.textContent('#final .score-big')) === '21', '전부 정답 21점');
  ok((await p2b.textContent('#star-box')).includes('100%') && (await p2b.textContent('#star-box')).includes('별 +1'), "100% → '슈퍼스타 별 +1 적립' 안내");
  await p2b.waitForFunction(() => document.getElementById('star-sub').textContent.includes('더해졌어요'));
  ok(true, '수파베이스 응답(first) → 내 별에 더해졌어요');
  await p2b.close();

  /* ========== 3c) 형태소 — 실질/형식·자립/의존은 드롭다운 대신 연보라 알약 (2026-09-14) ========== */
  const p2c = await ctx.newPage(); p2c.on('dialog', d => d.accept());
  await p2c.goto(`http://localhost:${PORT}/test.html?c=mor&r=1&preview=1`);
  await p2c.waitForSelector('.q-card');
  ok(await p2c.$eval('#sel-0-0', e => e.classList.contains('hid') && getComputedStyle(e).display === 'none'), '형태소 줄의 드롭다운은 숨김(값 저장용)');
  ok((await p2c.$$('#card-0 .step-row:nth-child(1) .pills')).length === 2 && (await p2c.$$eval('#card-0 .pills[data-for="sel-0-0"] .pill', bs => bs.map(b => b.textContent))).join('/') === '실질/형식' && (await p2c.$$eval('#card-0 .pills[data-for="sel2-0-0"] .pill', bs => bs.map(b => b.textContent))).join('/') === '자립/의존', '줄마다 알약 두 묶음(실질/형식 · 자립/의존)');
  ok(await p2c.$eval('#card-0 .pills[data-for="sel-0-0"] .pill', e => { const s = getComputedStyle(e); return s.borderTopWidth === '0px' && s.backgroundColor === 'rgb(237, 228, 244)' && parseFloat(s.borderTopLeftRadius) >= 20; }), '알약 = 테두리 없음 + 연보라 #EDE4F4 + 둥근 모서리');
  ok((await p2c.textContent('#card-0 .pills[data-for="sel-0-0"] .pl-lab')) === '실질/형식', "묶음 앞 작은 안내 글 '실질/형식'");
  await p2c.click('#card-0 .pills[data-for="sel-0-0"] .pill[data-v="실질"]');
  await p2c.waitForFunction(() => { const e = document.querySelector('#card-0 .pills[data-for="sel-0-0"] .pill[data-v="실질"]'); return e.classList.contains('on') && getComputedStyle(e).backgroundColor === 'rgb(107, 91, 123)'; });   // 색 전환(.12s) 뒤
  ok(await p2c.inputValue('#sel-0-0') === '실질', '알약을 누르면 값이 담기고 진한 연보라로 선택 표시(마우스를 올린 채로도)');
  await p2c.click('#card-0 .pills[data-for="sel-0-0"] .pill[data-v="실질"]');
  ok(await p2c.inputValue('#sel-0-0') === '', '같은 알약을 다시 누르면 해제');
  await p2c.fill('#frm-0-0', '나무'); await p2c.click('#card-0 .pills[data-for="sel-0-0"] .pill[data-v="실질"]'); await p2c.click('#card-0 .pills[data-for="sel2-0-0"] .pill[data-v="자립"]');
  await p2c.fill('#frm-0-1', '꾼'); await p2c.click('#card-0 .pills[data-for="sel-0-1"] .pill[data-v="형식"]'); await p2c.click('#card-0 .pills[data-for="sel2-0-1"] .pill[data-v="의존"]');
  await p2c.waitForFunction(() => document.getElementById('filled-count').textContent === '1');
  ok(true, '알약·빈칸을 다 채우면 완료 1 (진행 카운트가 알약 클릭을 센다)');
  await p2c.click('#card-1 .pills[data-for="sel-1-0"] .pill[data-v="형식"]');
  await p2c.click('#student-info'); await p2c.fill('#si-name', '박검증'); await p2c.fill('#si-school', '화정고'); await p2c.selectOption('#si-grade', '고1'); await p2c.fill('#si-phone8', '12345678');
  await p2c.click('#submit-btn'); await p2c.waitForSelector('.final.show');
  ok(await p2c.$eval('#card-0', e => e.classList.contains('correct')) && await p2c.$eval('#card-0 .pills[data-for="sel-0-0"]', e => e.classList.contains('ok')), '1번 정답 — 알약 묶음 초록 표시');
  ok(await p2c.$eval('#card-1 .pills[data-for="sel-1-0"]', e => e.classList.contains('ng') && e.classList.contains('done')) && await p2c.$eval('#card-1 .pills[data-for="sel-1-0"] .pill', e => e.disabled), '2번 오답 — 붉은 표시 + 알약 잠금');
  ok(await p2c.$eval('#card-1 .pills[data-for="sel2-1-0"]', e => e.classList.contains('none')), '안 고른 묶음은 안내 글이 붉게');
  await p2c.close();
  // 음운(선택지 15개)은 종전 드롭다운 그대로
  const p2d = await ctx.newPage();
  await p2d.goto(`http://localhost:${PORT}/test.html?c=pho&r=1&preview=1`);
  await p2d.waitForSelector('#app:not(.hidden)'); await p2d.click('#tab-test'); await p2d.waitForSelector('.q-card');
  ok(!(await p2d.$('#card-0 .pills')) && !(await p2d.$eval('#sel-0-0', e => e.classList.contains('hid'))), '음운 변동 종류(선택지 많음)는 드롭다운 유지');
  await p2d.close();

  /* ========== 4) 미등록 테스트 안내 ========== */
  const p3 = await ctx.newPage();
  await p3.goto(`http://localhost:${PORT}/test.html?c=pos&r=1`);
  await p3.waitForSelector('.loading-msg.fail');
  ok((await p3.textContent('.loading-msg.fail')).includes('아직 등록되지 않은'), '미등록 테스트(품사 1회) 안내');
  await p3.close();

  /* ========== 5) index.html — 배정 목록 ========== */
  assignItems = [{ cat: 'pho', round: '3', catLabel: '음운', memo: '숙제', due: '2026-09-05' }, { cat: 'mor', round: '1', catLabel: '형태소' }];
  starStatusItems = [{ unit: '음운', round: '3', best: 95, tries: 1, star: true }, { unit: '형태소', round: '1', best: 60, tries: 2, star: false }];
  const p4 = await ctx.newPage();
  p4.on('dialog', d => d.accept());
  await p4.goto(`http://localhost:${PORT}/index.html`);
  await p4.fill('#si-name', '박검증'); await p4.fill('#si-school', '화정고'); await p4.selectOption('#si-grade', '고1'); await p4.fill('#si-phone8', '12345678');
  await p4.click('#check-btn');
  await p4.waitForSelector('.assign-card');
  const cards = await p4.$$('.assign-card');
  ok(cards.length === 2, '배정 카드 2장');
  ok((await p4.textContent('.assign-card .assign-title')).includes('음운 3회'), '카드에 카테고리·회차·제목');
  const href = await p4.getAttribute('.assign-card .assign-go', 'href');
  ok(href.includes('test.html?c=pho&r=3') && href.includes('name=') && decodeURIComponent(href).includes('박검증') && href.includes('p8=12345678'), '응시 링크에 학생 정보·전화 8자리 전달');
  ok((await p4.textContent('.assign-card .assign-sub')).includes('마감 9월 5일 (토)까지'), '카드에 마감일 표시');
  await p4.waitForSelector('.assign-star');
  ok((await p4.textContent('.assign-card:nth-child(1) .assign-star')).includes('별 획득 95%') && (await p4.textContent('.assign-card:nth-child(2) .assign-star')).includes('최고 60%'), "카드에 '별 획득 95%' / '최고 60%' 표시");
  ok((await p4.textContent('#status')).includes('별을 받은 테스트 1개'), "상태 줄에 '별을 받은 테스트 1개'");
  ok((await p4.textContent('.header')).includes('90% 이상') && (await p4.textContent('.header')).includes('별'), "입구 페이지에 '90% 이상이면 별 +1' 안내");
  // 배정 없음 안내
  assignItems = [];
  await p4.click('#check-btn');
  await p4.waitForFunction(() => document.getElementById('status').textContent.includes('배정한 문법 테스트는 없어요'));
  ok(true, '배정 없음 안내');

  /* ========== 5b) index.html — 자유 응시: 단원 카드 → 레벨 탭 → 회차 → 응시 (2026-09-14) ========== */
  const catCards = await p4.$$('#cats .cat-card');
  const catCodes = await p4.$$eval('#cats .cat-card', els => els.map(e => e.getAttribute('data-code')));
  ok(catCards.length === 12 - 2 && !catCodes.includes('ort2') && !catCodes.includes('mor2'), '단원 카드 = 메뉴 단위(레벨2는 카드 안으로) 10장');
  ok(await p4.$eval('#cats .cat-card[data-code="pos"]', e => e.disabled && e.textContent.includes('준비 중')), '문항 없는 단원은 준비 중(비활성)');
  ok((await p4.textContent('#cats .cat-card[data-code="ort"]')).includes('레벨1 32회') && (await p4.textContent('#cats .cat-card[data-code="ort"]')).includes('레벨2 222회'), '한글 맞춤법 카드에 레벨1 32회 · 레벨2 222회');
  await p4.click('#cats .cat-card[data-code="ort"]');
  await p4.waitForSelector('#round-view:not(.hidden)');
  ok(await p4.$eval('#cat-view', e => e.classList.contains('hidden')), '단원을 누르면 회차 화면');
  ok((await p4.$$('#lvl-tabs .lvl-tab')).length === 2 && await p4.$eval('#lvl-tabs .lvl-tab[data-code="ort"]', e => e.classList.contains('on')), '레벨 탭 2개, 레벨1 기본 선택');
  ok((await p4.textContent('#sec-title')).includes('한글 맞춤법 · 레벨1') && (await p4.$$('#rounds .row')).length === 32, '레벨1 회차 32줄');
  ok((await p4.textContent('#rounds .row:nth-child(2) .ttl')).includes('된소리 (1)') && (await p4.textContent('#rounds .row:nth-child(2) .rd')) === '2', '회차 줄에 번호·제목');
  await p4.click('#lvl-tabs .lvl-tab[data-code="ort2"]');
  await p4.waitForFunction(() => document.getElementById('sec-title').textContent.includes('레벨2'));
  const grps = await p4.$$('#rounds details.grp');
  ok(grps.length >= 5 && (await p4.textContent('#rounds details.grp:nth-child(1) summary')).includes('제1장 총칙') && (await p4.$$('#rounds .row')).length === 222, '레벨2는 장별 접이식 + 222줄');
  // 학생 정보를 지우고 응시하기 → 안내만, 이동 없음
  await p4.fill('#si-name', '');
  const dlg5 = [];
  p4.removeAllListeners('dialog'); p4.on('dialog', d => { dlg5.push(d.message()); d.accept(); });
  await p4.click('#lvl-tabs .lvl-tab[data-code="ort"]');
  await p4.click('#rounds .row:nth-child(2) button.go');
  await p4.waitForTimeout(300);
  ok(dlg5.some(m => m.includes('학생 정보')) && p4.url().includes('index.html'), '정보가 비면 응시하기가 안내만 하고 이동하지 않음');
  // 정보를 채우면 test.html로 (free=1 + 이름·학교·학년·8자리)
  await p4.fill('#si-name', '박검증');
  await Promise.all([p4.waitForNavigation(), p4.click('#rounds .row:nth-child(2) button.go')]);
  const u5 = decodeURIComponent(p4.url());
  ok(u5.includes('test.html?c=ort&r=2&free=1') && u5.includes('name=박검증') && u5.includes('school=화정고') && u5.includes('grade=고1') && u5.includes('p8=12345678'), '응시하기 → test.html?free=1 + 학생 정보 전달');
  await p4.waitForSelector('#app:not(.hidden)');
  ok(await p4.inputValue('#si-name') === '박검증' && await p4.inputValue('#si-school') === '화정고' && await p4.inputValue('#si-phone8') === '12345678', '테스트 페이지에 이름·학교·전화 8자리 채워짐');
  // free=1 제출 — 배정 확인 없이 채점, 결과 시트·별은 그대로 기록
  assignItems = [];
  const prevReqs5 = reqLog.length, prevSb5 = sbCalls.length;
  await p4.click('#tab-test');
  await p4.click('#submit-btn');
  await p4.waitForSelector('.final.show');
  ok(!reqLog.slice(prevReqs5).some(q => q.action === 'myAssign'), 'free=1 은 배정 확인 생략(배정 없어도 제출)');
  ok(lastPost && lastPost.unit === '한글 맞춤법' && '' + lastPost.round === '2' && lastPost.name === '박검증', '자유 응시 결과도 시트로 전송');
  ok(sbCalls.slice(prevSb5).some(c => c.fn === 'gramma_submit' && c.body.unit === '한글 맞춤법' && c.body.round === '2'), '자유 응시도 gramma_submit(별 판정) 호출');
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
  ok((await p7.$$('.cat-card')).length === 10, '카테고리 카드 10개 (레벨2는 한글 맞춤법 카드 안)');
  ok((await p7.$$('.cat-card[disabled]')).length === 7, '문항 없는 카테고리 7개는 비활성(준비 중)');
  ok(!(await p7.$('#round-view:not(.hidden)')), '첫 화면에는 회차 목록 없음');
  // 음운 → 회차 20개 → 뒤로 → 한글 맞춤법 → 32개
  await p7.click('.cat-card[data-code="pho"]');
  await p7.waitForSelector('#round-view:not(.hidden)');
  ok((await p7.$$('#rounds .row')).length === 20, '음운 회차 20개');
  await p7.click('#cat-back');
  await p7.waitForSelector('#home-view:not(.hidden)');
  await p7.click('.cat-card[data-code="ort"]');
  await p7.waitForFunction(() => document.querySelectorAll('#rounds .row').length === 32);
  ok(true, '한글 맞춤법 회차 32개');
  // 미리보기 링크에 preview=1
  const prevHref = await p7.getAttribute('#rounds .row .abtn.preview', 'href');
  ok(prevHref.includes('test.html?c=ort&r=1') && prevHref.includes('preview=1'), '미리보기 링크');
  // 학생 배정 카드가 페이지 상단에 항상 있고, 위젯이 바로 뜬다
  ok(await p7.$('#assign-card'), '학생 배정 카드 상시 표시');
  await p7.waitForSelector('.sp-tab');
  const tabLabels = await p7.$$eval('.sp-tab', els => els.map(e => e.textContent.trim()));
  ok(tabLabels.join(',') === '전 학년,학년,개인,일부', '학생 선택 위젯 탭 (전 학년/학년/개인/일부)');
  ok((await p7.textContent('#sel-box')).includes('담은 테스트가 없어요'), '빈 담기 안내');
  // 담지 않고 배정 → 안내
  await p7.click('#f-add');
  await p7.waitForFunction(() => document.getElementById('f-status').textContent.includes('먼저 담아'));
  ok(true, '담은 테스트 없으면 배정 차단 안내');
  // 2단계 흐름 — 카테고리(1단계)가 위, 학생 배정 카드가 아래
  ok(await p7.$eval('#round-view', el => {
    const card = document.getElementById('assign-card');
    return !!(el.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), '학생 배정 카드가 카테고리 아래(2단계) 위치');
  // 하단 고정 바 — 비어 있을 때
  ok((await p7.textContent('#sb-list')).includes('아직 없습니다') && await p7.$('#go-assign.off'), '하단 바: 담긴 회차 없음 + 버튼 비활성 색');
  ok((await p7.textContent('#sec-title')).includes('전체 32회 · 담김 0'), "제목 옆 '전체 32회 · 담김 0'");
  // [전체 회차 담기] → 32개 담김 + 하단 바 'N개 회차' → [비우기]
  await p7.click('#sec-all');
  await p7.waitForFunction(() => document.querySelectorAll('#sel-box .sel-chip').length === 32);
  ok(true, "'전체 회차 담기'로 32회 전부 담김");
  ok((await p7.textContent('#sb-list')).includes('32개 회차') && !(await p7.$('#go-assign.off')), "하단 바 '32개 회차' + 버튼 활성");
  ok((await p7.textContent('#sec-title')).includes('담김 32') && (await p7.$$('#rounds .row.on')).length === 32, "'담김 32' + 담긴 행 표시");
  ok(await p7.$eval('#sec-all', el => el.disabled), '전부 담기면 [전체 회차 담기] 비활성');
  await p7.click('#sec-clear');
  await p7.waitForFunction(() => document.querySelectorAll('#sel-box .sel-chip').length === 0);
  ok((await p7.textContent('#sb-list')).includes('아직 없습니다') && await p7.$('#go-assign.off'), "[비우기]로 비우면 하단 바 '아직 없습니다'");
  ok((await p7.$$('#rounds .row.on')).length === 0, '비우면 담긴 행 표시 해제');
  // 회차 목록이 2열 그리드
  ok(await p7.$eval('#rounds', el => getComputedStyle(el).gridTemplateColumns.split(' ').length === 2), '회차 목록 2열 그리드');
  ok(await p7.$eval('#selbar', el => getComputedStyle(el).position === 'sticky'), '하단 담긴 회차 바 고정(sticky)');
  ok((await p7.textContent('#steps')).replace(/\s/g,'') === '배정하기›학생선택›완료' && (await p7.textContent('#steps .cur')) === '배정하기', '진행 표시: 배정하기 › 학생 선택 › 완료');
  // ① 여러 회차 담기 — 한글 맞춤법 1회 + (다른 카테고리) 음운 1회
  await p7.click('#rounds .row .abtn.assign');   // ort 1회 담기
  await p7.waitForFunction(() => document.querySelectorAll('#sel-box .sel-chip').length === 1);
  ok((await p7.textContent('#rounds .row .abtn.assign')).includes('담김'), "담은 회차 버튼이 '담김'으로");
  await p7.click('#cat-back');
  await p7.waitForSelector('#home-view:not(.hidden)');
  await p7.click('.cat-card[data-code="pho"]');
  await p7.waitForSelector('#round-view:not(.hidden)');
  await p7.click('#rounds .row .abtn.assign');   // pho 1회 담기
  await p7.waitForFunction(() => document.querySelectorAll('#sel-box .sel-chip').length === 2);
  const chipTxt = await p7.textContent('#sel-box');
  ok(chipTxt.includes('한글 맞춤법 1회') && chipTxt.includes('음운 1회'), '담은 테스트 칩 2개 (카테고리 섞어 담기)');
  ok((await p7.textContent('#sb-list')).replace(/\s/g,'') === '한글맞춤법1회·음운1회', "하단 바 목록 '한글 맞춤법 1회 · 음운 1회'");
  await p7.click('#go-assign');
  ok((await p7.textContent('#steps .cur')) === '학생 선택', "[학생 배정으로 →] 누르면 진행 표시 '학생 선택'");
  ok((await p7.textContent('#f-add')).includes('테스트 2개'), '배정 버튼에 담은 개수 표시');
  // 전 학년 + 마감일로 한 번에 배정 → assignAdd 2건
  await p7.waitForFunction(() => document.querySelector('.sp-summary').textContent.includes('전 학년'));
  await p7.fill('#f-due', '2026-09-05');
  await p7.fill('#f-memo', '1회차');
  await p7.click('#f-add');
  await p7.waitForFunction(() => document.querySelectorAll('#a-tbody tr').length === 3);
  const allReqs = reqLog.filter(q => q.action === 'assignAdd' && q.ttype === '전체');
  ok(allReqs.length === 2 && allReqs.every(q => q.target === '' && q.due === '2026-09-05' && q.memo === '1회차'), "'전 학년' assignAdd 2건 (담은 회차마다, 빈 대상 + 마감일)");
  ok(allReqs.some(q => q.cat === 'ort' && q.round === '1') && allReqs.some(q => q.cat === 'pho' && q.round === '1'), '두 회차 모두 배정됨');
  ok((await p7.textContent('#a-tbody')).includes('전 학년') && (await p7.textContent('#a-tbody')).includes('2026-09-05'), "현황에 '전 학년'·마감일 표시");
  await p7.waitForFunction(() => document.querySelectorAll('#sel-box .sel-chip').length === 0);
  ok(true, '배정 후 담긴 목록 비움');
  ok((await p7.textContent('#steps .cur')) === '완료', "배정 성공 뒤 진행 표시 '완료'");
  // ② 일부 — 재원 명단에서 두 명 선택해 음운 1회 배정
  await p7.click('#rounds .row .abtn.assign');   // pho 1회 다시 담기
  await p7.click('.sp-tab[data-mode="일부"]');
  await p7.waitForSelector('.sp-item');
  await p7.click('.sp-item:has-text("박보검")');
  await p7.click('.sp-item:has-text("김철수")');
  await p7.waitForFunction(() => document.querySelector('.sp-summary').textContent.includes('2명'));
  await p7.click('#f-add');
  await p7.waitForFunction(() => document.querySelectorAll('#a-tbody tr').length === 4);
  const someReq = reqLog.find(q => q.action === 'assignAdd' && q.ttype === '일부');
  ok(someReq && someReq.target === '박보검, 김철수', "'일부' assignAdd — 명단에서 고른 이름들");
  ok((await p7.textContent('#a-tbody')).includes('일부 학생'), "현황에 '일부 학생' 표시");
  // ③ 학년 — 고1 칩 선택
  await p7.click('#rounds .row .abtn.assign');
  await p7.click('.sp-tab[data-mode="학년"]');
  await p7.waitForSelector('.sp-chip');
  await p7.click('.sp-chip[data-grade="고1"]');
  await p7.click('#f-add');
  await p7.waitForFunction(() => document.querySelectorAll('#a-tbody tr').length === 5);
  const grReq = reqLog.find(q => q.action === 'assignAdd' && q.ttype === '학년');
  ok(grReq && grReq.target === '고1' && grReq.cat === 'pho' && grReq.round === '1', "'학년' assignAdd 파라미터");
  // ④ 회차 줄은 [미리보기]+[담기]만 (링크 복사·현황 버튼 제거 — 사용자 확정)
  ok(!(await p7.$('#rounds .abtn.stat')) && !(await p7.$('#rounds .abtn.copy')), '회차 줄에 링크 복사·현황 버튼 없음');
  ok(!(await p7.$('#entry-copy')), "'입구' 줄 제거");
  ok((await p7.textContent('#assign-card')).includes('메모 (선택)'), "'메모 (선택)' 라벨");
  // 마감 → 삭제
  await p7.click('#a-tbody .a-toggle');
  await p7.waitForFunction(() => document.getElementById('a-tbody').textContent.includes('마감'));
  ok(reqLog.some(q => q.action === 'assignSet' && q.status === '마감'), '마감 요청');
  await p7.click('#a-tbody .a-del');
  await p7.waitForFunction(() => document.querySelectorAll('#a-tbody tr').length === 4);
  ok(reqLog.some(q => q.action === 'assignDel'), '삭제 요청·목록 갱신');
  // 줄 선택 — 클릭·Shift 범위·전체 선택·선택 삭제(아래 줄부터)
  {
    const n0 = (await p7.$$('#a-tbody tr[data-key]')).length;
    ok(n0 >= 4, '현황 4줄 이상(선택 검사 준비)');
    await p7.click('#a-tbody tr[data-key]:nth-child(1) td:nth-child(2)');
    ok((await p7.textContent('#a-seln')) === '1' && await p7.$('#a-selbar.on'), '줄 클릭 → 1개 선택 + 선택 줄 표시');
    await p7.click('#a-tbody tr[data-key]:nth-child(3) td:nth-child(2)', { modifiers: ['Shift'] });
    ok((await p7.textContent('#a-seln')) === '3' && (await p7.$$('#a-tbody tr.sel')).length === 3, 'Shift+클릭 → 1~3줄 범위 선택');
    await p7.click('#a-tbody tr[data-key]:nth-child(2) td:nth-child(2)');
    ok((await p7.textContent('#a-seln')) === '2', '선택된 줄을 다시 누르면 해제');
    await p7.click('#a-tbody tr[data-key]:nth-child(1) .a-toggle');   // 버튼은 선택과 무관
    await p7.waitForFunction(() => document.getElementById('a-status').textContent === '' || document.getElementById('a-status').style.display === 'none');
    ok((await p7.textContent('#a-seln')) === '0', '동작 뒤 목록을 새로 받으면 선택 초기화');
    await p7.click('#a-all');
    ok((await p7.textContent('#a-seln')) === '' + n0, '[전체 선택] 체크 → 모두 선택');
    await p7.click('#a-tbody tr[data-key]:nth-child(1) td:nth-child(2)');
    const before = reqLog.filter(q => q.action === 'assignDel').length;
    await p7.click('#a-sel-del');
    await p7.waitForFunction(n => document.querySelectorAll('#a-tbody tr[data-key]').length === n, n0 - (n0 - 1) );
    const dels = reqLog.filter(q => q.action === 'assignDel').slice(before);
    ok(dels.length === n0 - 1, `[선택 삭제] → 선택한 ${n0 - 1}개만 삭제 요청`);
    ok(dels.every((q, i) => i === 0 || +q.row < +dels[i - 1].row), '삭제는 아래 줄(행번호 큰 것)부터 차례로');
    ok((await p7.$$('#a-tbody tr[data-key]')).length === 1 && (await p7.textContent('#a-seln')) === '0', '삭제 뒤 1줄 남고 선택 없음');
  }
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
  // 2026-09-13 디자인: 개념 카드·분류 칩은 1px #E5EDE8 테두리, 규칙 문장은 왼쪽 2px 선, 예시는 칩(회색 상자 없음)
  ok(await p8.$eval('.vocab-card', el => getComputedStyle(el).borderTopWidth === '1px' && getComputedStyle(el).borderTopColor === 'rgb(229, 237, 232)'), '개념 카드 1px #E5EDE8 테두리');
  ok(await p8.$eval('.cat-label.active', el => getComputedStyle(el).backgroundColor === 'rgb(237, 228, 244)' && getComputedStyle(el).borderRadius === '999px'), '선택된 분류 칩 = 연보라 알약');
  ok((await p8.textContent('#cat-count')).match(/^\d+개 규칙$/), "칩 줄 오른쪽 'N개 규칙'");
  ok(await p8.$eval('.vocab-meaning', el => getComputedStyle(el).borderLeftWidth === '2px' && getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'), '규칙 문장은 왼쪽 선만(회색 박스 없음)');
  ok((await p8.$$('.vocab-example .ex-chip')).length >= 3 && await p8.$eval('.vocab-example', el => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'), '예시 단어 칩 + 감싸는 상자 없음');
  ok(await p8.$eval('.mode-tabs', el => getComputedStyle(el).borderRadius === '999px') && await p8.$eval('.mode-label.active', el => getComputedStyle(el).borderTopWidth === '0px'), '모드 토글 = 알약형');
  await p8.close();

  /* ========== 10) 한글 맞춤법 채점 화면 — 보기 정오 표시·근거 조항 ========== */
  const p9 = await ctx.newPage();
  p9.on('dialog', d => d.accept());
  await p9.goto(`http://localhost:${PORT}/test.html?c=ort&r=2&preview=1`);
  await p9.waitForSelector('#app:not(.hidden)');
  await p9.click('#tab-test');
  await p9.click('#student-info');
  await p9.fill('#si-name', '박검증'); await p9.fill('#si-school', '화정고');
  await p9.selectOption('#si-grade', '고1'); await p9.fill('#si-phone8', '12345678');
  await p9.$$eval('.opt-label[data-opt="1"]', els => els[0] && els[0].click());   // 선택형 1번 고름
  await p9.$$eval('.answer-input', els => { if (els[0]) els[0].value = '아무말'; });
  await p9.click('#submit-btn');
  await p9.waitForSelector('.final.show');
  ok((await p9.$$('.opt-label.ans')).length >= 1, '선택형 정답 보기에 초록 표시');
  ok((await p9.textContent('.opt-label.ans')).includes('정답'), "정답 보기에 '정답' 표기");
  ok((await p9.$$('.ox-label.ans')).length >= 1, 'OX 정답 버튼 표시');
  ok((await p9.$$('.ox-label.pick-ng, .opt-label.pick-ng')).length >= 0, '내가 고른 오답 표시 자리');
  ok((await p9.$$('.answer-input.ng')).length >= 1, '틀린 단답 입력칸 붉은 표시');
  ok((await p9.$$('.fb-art')).length >= 1, '해설의 근거 조항이 칩으로 분리');
  ok((await p9.textContent('.fb-art')).startsWith('제'), '근거 조항 칩 내용 (제○항)');
  await p9.close();

  /* ========== 11) 한글 맞춤법 레벨2 — 장별 묶음 배정 + 지문 상자 ========== */
  const p10 = await ctx.newPage();
  await p10.goto(`http://localhost:${PORT}/assign.html`);
  await p10.waitForSelector('.cat-card[data-code="ort"]');
  ok(!(await p10.$('.cat-card[data-code="ort2"]')) && (await p10.textContent('.cat-card[data-code="ort"]')).includes('레벨1 32회 · 레벨2 222회'), "'한글 맞춤법' 카드 하나에 '레벨1 32회 · 레벨2 222회'");
  await p10.click('.cat-card[data-code="pho"]');
  await p10.waitForSelector('#round-view:not(.hidden)');
  ok(await p10.$eval('#lvl-tabs', el => el.hidden), '음운에는 레벨 탭 없음');
  await p10.click('#cat-back');
  await p10.click('.cat-card[data-code="ort"]');
  await p10.waitForSelector('#round-view:not(.hidden)');
  ok(!(await p10.$eval('#lvl-tabs', el => el.hidden)) && (await p10.$$('.lvl-tab')).length === 2 && (await p10.textContent('.lvl-tab.on')).includes('레벨1'), '한글 맞춤법 = 레벨 탭 2개, 레벨1 기본');
  ok((await p10.$$('#rounds .row')).length === 32 && (await p10.textContent('#sec-title')).includes('한글 맞춤법 · 레벨1'), '레벨1 = 32회');
  await p10.click('.lvl-tab[data-code="ort2"]');
  await p10.waitForFunction(() => document.querySelectorAll('#rounds .row').length === 222);
  ok((await p10.textContent('.lvl-tab.on')).includes('레벨2') && (await p10.textContent('#sec-title')).includes('한글 맞춤법 · 레벨2'), '[레벨2] 탭 → 제목 한글 맞춤법 · 레벨2');
  ok((await p10.$$('#rounds .row')).length === 222, '레벨2 회차 222개');
  ok((await p10.$$('#rounds details.grp')).length === 6, '장(章)별 묶음 6개');
  const g1 = await p10.textContent('#rounds details.grp:first-child summary');
  ok(g1.includes('제1장 총칙') && g1.includes('10회'), '첫 묶음 = 제1장 총칙 · 10회');
  ok((await p10.$$('#rounds details.grp[open]')).length === 0, '묶음은 처음에 접혀 있음');
  await p10.click('#rounds details.grp:first-child summary .gn');
  ok((await p10.$$('#rounds details.grp[open]')).length === 1, '묶음 제목을 누르면 펼쳐짐');
  ok((await p10.textContent('#rounds details.grp:first-child .row .ttl')).includes('제1항 총칙 (1/3)'), '회차 제목 (조항·주제·차례)');
  await p10.click('#rounds details.grp:first-child .grp-all');
  await p10.waitForFunction(() => document.querySelectorAll('#sel-box .sel-chip').length === 10);
  ok(true, "[이 장 담기] → 제1장 10회 담김");
  ok((await p10.$$('#rounds details.grp[open]')).length === 1, '담기 버튼을 눌러도 묶음이 접히지 않음');
  ok((await p10.textContent('#sel-box .sel-chip')).includes('한글 맞춤법 레벨2 1회 · 제1항 총칙 (1/3)'), '담은 칩에 회차 제목 표시');
  ok((await p10.textContent('#rounds details.grp:first-child .grp-all')).includes('이 장 빼기'), "다 담기면 '이 장 빼기'");
  await p10.click('#rounds details.grp:first-child .grp-all');
  await p10.waitForFunction(() => document.querySelectorAll('#sel-box .sel-chip').length === 0);
  ok(true, "[이 장 빼기] → 비움");
  await p10.click('#sec-all');
  await p10.waitForFunction(() => document.querySelectorAll('#sel-box .sel-chip').length === 222);
  ok((await p10.textContent('#sec-title')).includes('담김 222') && (await p10.$$('#rounds .row.on')).length === 222, "'전체 회차 담기'로 222회 전부 담김 + 담긴 행 표시");
  ok((await p10.$$('#rounds details.grp .grp-all.on')).length === 6, '여섯 장 모두 [이 장 빼기]');
  ok(await p10.$eval('#rounds > details.grp', el => getComputedStyle(el).gridColumnEnd === '-1' || el.getBoundingClientRect().width > document.getElementById('rounds').getBoundingClientRect().width * 0.9), '묶음이 2열 그리드 전체 폭');
  await p10.click('#sec-clear');
  await p10.waitForFunction(() => document.querySelectorAll('#sel-box .sel-chip').length === 0);
  await p10.close();

  const p11 = await ctx.newPage();
  await p11.goto(`http://localhost:${PORT}/test.html?c=ort2&r=1&preview=1`);
  await p11.waitForSelector('#app:not(.hidden)');
  ok(!(await p11.$eval('#mode-tabs', el => el.classList.contains('hidden'))), '레벨2: 개념 정리/테스트 모드 탭 표시');
  ok((await p11.textContent('#h-round')).includes('한글 맞춤법 레벨2 1회') && (await p11.textContent('#h-round')).includes('제1항'), '머리글에 카테고리·회차·조항');
  ok((await p11.$$('#study-body .psg')).length === 1 && !(await p11.$eval('#study-body .psg .psg-body', el => el.hidden)), '개념 정리 탭 = 지문 전문(해설 펼침)');
  ok((await p11.textContent('#study-body .psg-text')).includes('한글 맞춤법은 표준어를 소리대로 적되'), '조항 원문 표시');
  ok((await p11.$$('#study-body .psg-body p')).length >= 3, '해설이 문단으로 나뉨');
  await p11.click('#tab-test');
  ok((await p11.$$('#questions .psg')).length === 1, '테스트 모드 문항 위 지문 상자');
  ok(await p11.$eval('#questions .psg .psg-body', el => el.hidden), '테스트 모드 해설은 접힘');
  await p11.click('#questions .psg-toggle');
  ok(!(await p11.$eval('#questions .psg .psg-body', el => el.hidden)) && (await p11.textContent('#questions .psg-toggle')).includes('접기'), '[해설 펼치기] → 펼침');
  ok((await p11.$$('.q-card')).length === 20 && (await p11.$$('.ox-label')).length === 40, 'OX 20문항');
  await p11.close();
  const p12 = await ctx.newPage();   // 제5항(16회) — 예시 표가 줄 단위로 보이는지
  await p12.goto(`http://localhost:${PORT}/test.html?c=ort2&r=16&preview=1`);
  await p12.waitForSelector('#app:not(.hidden)');
  ok((await p12.$$('#study-body .psg-ex')).length >= 3, '예시 표 블록 표시');
  const exRows = await p12.$$eval('#study-body .psg-ex:first-of-type span', els => els.map(e => e.textContent));
  ok(exRows.length === 3 && exRows[0].startsWith('소쩍새 · 어깨') && exRows[2].startsWith('거꾸로'), '표 줄이 줄 단위로(소쩍새 · 어깨 … / 거꾸로 …)');
  ok(await p12.$$eval('#study-body .psg-body p, #study-body .psg-ex span', els => els.every(e => !e.textContent.includes('된소리소쩍새') && !e.textContent.includes('아끼다기쁘다'))), '헤딩·표 칸이 낱말끼리 붙지 않음');
  await p12.close();

  await browser.close();
  server.close();
  console.log(bad ? `\n실패 ${bad}/${n}` : `\n전체 통과 (${n}건)`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
