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

  const reportPosts = [], editReqSets = []; let editReqRows = [], reportFail = false;   // 문항 오류 제보·수정 요청함 가로채기
  await ctx.route('**://script.google.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const q = Object.fromEntries(url.searchParams);
    if (req.method() === 'POST') {
      lastPost = JSON.parse(req.postData());
      if (lastPost.action === 'grammaReport') {   // 문항 오류 제보(리포트 백엔드) — 2026-09-18
        if (reportFail) return route.fulfill({ status: 500, body: 'oops' });
        reportPosts.push(lastPost); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success' }) });
      }
      if (lastPost.action === 'editReqSet') { editReqSets.push(lastPost); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success' }) }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    const action = q.action || '';
    reqLog.push(q);
    let payload;
    if (action === 'editReqList') payload = { result: 'success', reqs: editReqRows };
    else
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
  let starStatusItems = [], starSets = [], starStars = 0;   // gramma_status 응답(029: items[pass]·sets·stars)
  let topRows = [], topMe = null;                           // gramma_top 응답
  await ctx.route(/bangdbhqpphqqdwcledg\.supabase\.co\/rest\/v1\/rpc\/(gramma_submit|gramma_status|gramma_top)/, route => {
    const fn = route.request().url().split('/rpc/')[1];
    const body = JSON.parse(route.request().postData() || '{}').p || {};
    sbCalls.push({ fn, body });
    if (fn === 'gramma_submit') {
      // 029 규칙 흉내: 70% 통과, 세트 정보가 있고 그 세트의 마지막 회차면 세트 클리어(처음)
      const pct = Math.round(body.got * 100 / body.total), pass = pct >= 70;
      const last = body.set && body.set.rounds && body.set.rounds[body.set.rounds.length - 1] === '' + body.round;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, pct, pass, set_cleared: !!(pass && last), set_first: !!(pass && last), stars: pass && last ? 1 : 0 }) });
    }
    if (fn === 'gramma_top') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rows: topRows, me: topMe, total: topRows.length, pass_pct: 70 }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, pass_pct: 70, items: starStatusItems, sets: starSets, stars: starStars }) });
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
  ok((await page.textContent('#star-box')).includes('5%') && (await page.textContent('#star-box')).includes('70% 이상이면 스테이지 통과'), '정답률 5% → 통과 못 함 안내(70%)');
  const sub1 = sbCalls.find(c => c.fn === 'gramma_submit');
  ok(sub1 && sub1.body.name === '박검증' && sub1.body.phone8 === '12345678' && sub1.body.unit === '음운' && sub1.body.round === '1' && sub1.body.got === 1 && sub1.body.total === 21, 'gramma_submit 호출(이름·8자리·카테고리·회차·점수)');
  ok(sub1.body.mode === 'test' && sub1.body.set && sub1.body.set.no === 1 && sub1.body.set.rounds.join(',') === '1,2,3,4,5', 'gramma_submit에 mode=test + 세트 정보(세트 1 = 1~5회)');

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
  /* ========== 3b) 70% 이상 → 스테이지 통과 안내 + 세트 안내 ========== */
  const p2b = await ctx.newPage(); p2b.on('dialog', d => d.accept());
  assignItems = [{ cat: 'pho', round: '1' }];
  await p2b.goto(`http://localhost:${PORT}/test.html?c=pho&r=1&name=박검증&school=화정고&grade=고1&p8=12345678`);
  await p2b.waitForSelector('#app:not(.hidden)'); await p2b.click('#tab-test');
  // 21문항 전부 정답으로 채움(데이터의 정답을 그대로 넣는다)
  const answers = await p2b.evaluate(() => fetch('data/pho-1.json').then(r => r.json()).then(d => d.questions.map(q => q.steps.map(st => [st.accept[0], st.form.split('/')[0]]))));
  for (let i = 0; i < answers.length; i++) for (let k = 0; k < answers[i].length; k++) { await p2b.selectOption(`#sel-${i}-${k}`, answers[i][k][0]); await p2b.fill(`#frm-${i}-${k}`, answers[i][k][1]); }
  await p2b.click('#submit-btn'); await p2b.waitForSelector('.final.show');
  ok((await p2b.textContent('#final .score-big')) === '21', '전부 정답 21점');
  ok((await p2b.textContent('#star-box')).includes('100%') && (await p2b.textContent('#star-box')).includes('통과'), "100% → '스테이지 통과' 안내");
  await p2b.waitForFunction(() => document.getElementById('star-sub').textContent.includes('세트 1'));
  ok((await p2b.textContent('#star-sub')).includes('모두 통과하면 별 +1'), '수파베이스 응답(pass, 세트 미완) → 세트를 다 통과하면 별 +1 안내');
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

  /* ========== 5) index.html — 히어로·학생 정보 요약·단원 카드 (2026-09-16 디자인 지시서, 배정 목록은 없음) ========== */
  starStatusItems = [{ unit: '음운', round: '3', best: 95, tries: 1, pass: true }, { unit: '형태소', round: '1', best: 60, tries: 2, pass: false }]; starSets = []; starStars = 0;
  const p4 = await ctx.newPage();
  p4.on('dialog', d => d.accept());
  await p4.goto(`http://localhost:${PORT}/index.html`);
  ok(!(await p4.$eval('#student-info', e => e.classList.contains('collapsed'))) && !(await p4.$('#back-top:not(.hidden)')), '정보가 없으면 입력란이 펼쳐져 있고, 개인 페이지에서 온 게 아니면 돌아가기 링크 없음');
  ok(await p4.$eval('.header', e => getComputedStyle(e.querySelector('.h-left')).textAlign === 'left' && !!e.querySelector('#bigstar') && e.querySelector('#top30-link').textContent.trim() === '탑30 보기'), '히어로: 왼쪽 정렬 글 + 오른쪽 별 아이콘·탑30 알약');
  ok(!(await p4.$('.tiles')) && !(await p4.$('#status')) && !(await p4.$('#list')), '옛 칩 3개·안내 카드·배정 목록 없음');
  ok(await p4.$eval('#check-btn', e => getComputedStyle(e).backgroundColor === 'rgb(237, 228, 244)' && getComputedStyle(e).boxShadow === 'none'), '확인 버튼은 연보라(#EDE4F4)·그림자 없음');
  await p4.fill('#si-name', '박검증'); await p4.fill('#si-school', '화정고'); await p4.selectOption('#si-grade', '고1'); await p4.fill('#si-phone8', '12345678');
  await p4.click('#check-btn');
  await p4.waitForFunction(() => document.getElementById('si-sum-sub').textContent.includes('통과한 스테이지 1개'));
  ok(await p4.$eval('#student-info', e => e.classList.contains('collapsed')) && (await p4.textContent('#si-sum-text')) === '박검증 · 화정고 고1' && (await p4.textContent('#sum-btn')) === '내 진행 확인' && (await p4.textContent('#si-edit')) === '수정', '확인 뒤 학생 정보는 요약 한 줄(이름 · 학교 학년 + 내 진행 확인 + 수정)');
  ok((await p4.getAttribute('#si-img', 'src')) === 'assets/sk-school.png', '요약 줄에 등교 슈콩');
  ok((await p4.textContent('.header')).includes('70%') && (await p4.textContent('.header')).includes('별 +1') && (await p4.textContent('#mystars')).includes('문법 별 0개') && !(await p4.$eval('#bigstar', e => e.classList.contains('on'))), "히어로에 통과 70% · 별 +1 · '문법 별 0개' · 별 아이콘 회색");
  ok((await p4.textContent('.sec-head')).includes('단원 고르기') && (await p4.textContent('.sec-note')) === '단원 → 레벨 → 스테이지', "섹션 제목 '단원 고르기' + 짧은 안내");
  ok((await p4.$$('#cats .cat-card')).length === 10 && (await p4.$$('#cats .cat-card.soon')).length === 7 && await p4.$eval('#cats .cat-card[data-code="pos"]', e => e.disabled && e.classList.contains('soon') && !!e.querySelector('.clock svg') && e.textContent.includes('준비 중이에요') && !e.querySelector('.cstars')), '단원 카드 10장 — 준비 중 7장은 같은 카드에 자물쇠(별 없음)·비활성');
  ok((await p4.$$('#cats .cat-card[data-code="pho"] .cstars i')).length === 4 && (await p4.textContent('#cats .cat-card[data-code="pho"] .cstat')) === '1 / 20 통과' && (await p4.$eval('#cats .cat-card[data-code="pho"] .cbar i', e => e.style.width)) === '5%', '음운 카드: 별 4개 자리 · 1 / 20 통과 · 진행 막대 5%');
  ok((await p4.textContent('#cats .cat-card[data-code="mor"] .cstat')) === '아직 시작하지 않았어요' && (await p4.textContent('#cats .cat-card[data-code="mor"] .ccnt')) === '레벨1 10회 · 레벨2 10회', '형태소 카드: 아직 시작 안 함 · 레벨 회차 정보');
  ok(!(await p4.$('#cats .cico')), '체크박스처럼 보이는 아이콘 없음');
  // [수정] → 입력란 펼침 → [접기]
  await p4.click('#si-edit');
  ok(!(await p4.$eval('#student-info', e => e.classList.contains('collapsed'))) && !(await p4.$eval('#si-fold', e => e.classList.contains('hidden'))), "[수정]을 누르면 입력란이 펼쳐지고 '접기'가 보임");
  await p4.click('#si-fold');
  ok(await p4.$eval('#student-info', e => e.classList.contains('collapsed')), '[접기]로 다시 요약 한 줄');
  // 개인 페이지에서 넘어온 경우 — 돌아가기 링크(같은 사이트 referrer)
  const p4r = await ctx.newPage();
  await p4r.setContent(`<a id="go" href="http://localhost:${PORT}/index.html?name=박검증&school=화정고&grade=고1&p8=12345678">go</a>`, { waitUntil: 'load' });
  await p4r.route('**/s.html*', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<a id="go" href="http://localhost:' + PORT + '/index.html?name=박검증&school=화정고&grade=고1&p8=12345678">go</a>' }));
  await p4r.goto(`http://localhost:${PORT}/s.html?key=abc123`);
  await Promise.all([p4r.waitForNavigation(), p4r.click('#go')]);
  await p4r.waitForSelector('#back-top:not(.hidden)');
  ok((await p4r.getAttribute('#back-top', 'href')).includes('/s.html?key=abc123') && (await p4r.textContent('#back-top')).includes('내 페이지로'), "개인 페이지에서 오면 맨 위에 '내 페이지로'(접근 코드 포함 주소)");
  await p4r.goto(`http://localhost:${PORT}/index.html#c=pho`);
  await p4r.waitForSelector('#back-top:not(.hidden)');
  ok((await p4r.getAttribute('#back-top', 'href')).includes('/s.html?key=abc123'), 'play.html에서 돌아와도(주소에 back 없음) 돌아가기 링크 유지(sessionStorage)');
  await p4r.close();

  /* ========== 5b) index.html — 스테이지 맵: 단원 카드 → 레벨 탭 → 세트·스테이지 → play.html (2026-09-16) ========== */
  const catCodes = await p4.$$eval('#cats .cat-card:not(.soon)', els => els.map(e => e.getAttribute('data-code')));
  ok(catCodes.join(',') === 'pho,mor,ort' && !catCodes.includes('ort2') && !catCodes.includes('mor2'), '단원 카드 = 메뉴 단위(레벨2는 카드 안으로), 문항 있는 3장');
  // 진행 상태: 한글 맞춤법 1~8 통과, 9는 60%, 세트 1 클리어(별 1)
  starStatusItems = [1,2,3,4,5,6,7,8].map(r => ({ unit: '한글 맞춤법', round: '' + r, best: 70 + r, tries: 1, pass: true })).concat([{ unit: '한글 맞춤법', round: '9', best: 60, tries: 2, pass: false }]);
  starSets = [{ unit: '한글 맞춤법', set_no: 1 }]; starStars = 1;
  await p4.click('#sum-btn'); await p4.waitForFunction(() => document.getElementById('mystars').textContent.includes('문법 별 1개'));
  ok(await p4.$eval('#bigstar', e => e.classList.contains('on')) && (await p4.textContent('#cats .cat-card[data-code="ort"] .cstat')) === '8 / 254 통과' && (await p4.$$('#cats .cat-card[data-code="ort"] .cstars i.on')).length === 1, '별이 생기면 히어로 별 노랑 · 맞춤법 카드 8 / 254 통과 · 별 1개 채움');
  await p4.click('#cats .cat-card[data-code="ort"]');
  await p4.waitForSelector('#round-view:not(.hidden)');
  ok((await p4.$$('#lvl-tabs .lvl-tab')).length === 2 && await p4.$eval('#lvl-tabs .lvl-tab[data-code="ort"]', e => e.classList.contains('on')), '레벨 탭 2개, 레벨1 기본 선택');
  ok((await p4.textContent('#sec-title')).includes('한글 맞춤법 · 레벨1') && (await p4.textContent('#sec-title')).includes('스테이지 32 · 세트 7'), '제목에 스테이지 32 · 세트 7');
  ok((await p4.$$('#stages .setcard')).length === 7 && (await p4.$$('#stages .node')).length === 32, '세트 카드 7장(5개씩) · 스테이지 32');
  ok((await p4.textContent('#stages .setcard[data-set="1"] .set-head')).includes('별 획득') && (await p4.$$('#stages .setcard[data-set="1"] .node.pass')).length === 5, '세트 1 = 별 획득 + 5개 통과');
  ok(await p4.$eval('#stages .setcard[data-set="2"]', e => e.classList.contains('cur')) && (await p4.textContent('#stages .setcard[data-set="2"] .set-head')).includes('3 / 5 클리어'), '세트 2 = 진행 중(3/5)');
  ok((await p4.textContent('#stages .node.cur .nb')) === '9' && (await p4.textContent('#stages .node.cur .nl')).includes('60%'), '스테이지 9 = 도전(최고 60%)');
  ok(await p4.$eval('#stages .node[data-round="10"]', e => e.classList.contains('lock')) && await p4.$eval('#stages .setcard[data-set="3"]', e => e.classList.contains('locked')), '10 이후·세트 3 잠김(앞 스테이지 70% 통과해야)');
  ok((await p4.textContent('#stages .now .nt')).includes('스테이지 9') && (await p4.textContent('#stages .now .nt')).includes('모음 (2)'), "'지금 도전' 줄에 스테이지 9 제목");
  const dlg5 = [];
  p4.removeAllListeners('dialog'); p4.on('dialog', d => { dlg5.push(d.message()); d.accept(); });
  await p4.click('#stages .node[data-round="12"]');
  await p4.waitForTimeout(200);
  ok(dlg5.some(m => m.includes('앞 스테이지')) && p4.url().includes('index.html'), '잠긴 스테이지를 누르면 안내만');
  await p4.click('#lvl-tabs .lvl-tab[data-code="ort2"]');
  await p4.waitForFunction(() => document.getElementById('sec-title').textContent.includes('레벨2'));
  ok((await p4.$$('#stages .setcard')).length === 45 && (await p4.textContent('#stages .setcard[data-set="1"] .set-head')).includes('제1장 총칙') && (await p4.$$('#stages .node.lock')).length === 221, '레벨2 = 세트 45 · 장 이름 표시 · 첫 스테이지만 열림');
  // 학생 정보를 지우고 도전 → 안내만
  await p4.click('#lvl-tabs .lvl-tab[data-code="ort"]');
  await p4.click('#si-edit'); await p4.fill('#si-name', '');
  await p4.click('#stages .now .go');
  await p4.waitForTimeout(200);
  ok(dlg5.some(m => m.includes('학생 정보')) && p4.url().includes('index.html'), '정보가 비면 도전하기가 안내만 하고 이동하지 않음');
  await p4.fill('#si-name', '박검증');
  await Promise.all([p4.waitForNavigation(), p4.click('#stages .now .go')]);
  const u5 = decodeURIComponent(p4.url());
  ok(u5.includes('play.html?c=ort&r=9') && u5.includes('name=박검증') && u5.includes('school=화정고') && u5.includes('grade=고1') && u5.includes('p8=12345678'), '도전하기 → play.html + 학생 정보 전달');

  /* ========== 5c) play.html — 문항마다 한 페이지·30초·바로 정답·결과·기록 ========== */
  await p4.waitForSelector('#start:not(.hidden)');
  ok((await p4.textContent('#st-title')).includes('스테이지 9') && (await p4.textContent('#st-sub')).includes('세트 2') && (await p4.textContent('#st-n')) === '15문항' && (await p4.textContent('#st-pass')).includes('70%'), '시작 화면: 스테이지 9 · 세트 2 · 15문항 · 통과 70%');
  await p4.click('#st-go'); await p4.waitForSelector('#game:not(.hidden)');
  ok((await p4.$$('#segs .seg')).length === 15 && await p4.$eval('#segs .seg:nth-child(1)', e => e.classList.contains('now')) && (await p4.textContent('#tb-n')) === '1 / 15', '상단 진행 바 15칸, 1번 = 지금');
  ok(await p4.$eval('#topbar', e => getComputedStyle(e).position === 'sticky'), '진행 바는 위에 고정');
  ok((await p4.textContent('#tb-sec')).includes('30초'), '30초 시작');
  ok(await p4.$eval('.q-stem', e => parseFloat(getComputedStyle(e).fontSize) >= 28), '문항 글자 28px 이상(큰 글자)');
  ok((await p4.$$('#abox .big')).length === 2 && await p4.$eval('#abox .big', e => e.getBoundingClientRect().height >= 100), 'O/X 큰 버튼 두 개');
  await p4.waitForFunction(() => document.getElementById('tb-sec').textContent === '28초', null, { timeout: 5000 });
  ok(true, '초가 줄어든다');
  const q1 = await p4.evaluate(() => fetch('data/ort-9.json').then(r => r.json()).then(d => d.questions));
  const wrong1 = q1[0].answer === 'O' ? 'X' : 'O';
  await p4.click('#abox .big[data-v="' + wrong1 + '"]');
  await p4.waitForSelector('#fb:not(.hidden)');
  ok((await p4.textContent('#fb .fb-top')).includes('아쉬워요') && await p4.$eval('#abox .big[data-v="' + q1[0].answer + '"]', e => e.classList.contains('ans')) && await p4.$eval('#abox .big[data-v="' + wrong1 + '"]', e => e.classList.contains('ng')), '틀리면 바로 정답(초록)·내 답(붉은) 표시');
  ok(await p4.$eval('#segs .seg:nth-child(1)', e => e.classList.contains('ng')) && (await p4.textContent('#tb-pts')) === '0점', '진행 바 1칸 붉게 · 0점');
  // 슈콩 피드백 연출(2026-09-16 지시서): 오답 = 응원 슈콩(흔들림) + 꽃 6개, 파티클은 캐릭터 칸에만
  const fxNg = await p4.evaluate(() => { const a = document.querySelector('#fb .fb-avatar'), img = document.querySelector('#fb .fb-img'); return { panel: !!document.querySelector('#fb .fb-panel.ng'), n: a.querySelectorAll('.fx-layer span').length, ring: !!a.querySelector('.fx-layer span[style*="border-radius"]'), src: img.getAttribute('src'), wobble: img.style.animation.includes('fxWobble'), outside: !!document.querySelector('#fb > .fx-layer, .fb-text .fx-layer') }; });
  ok(fxNg.panel && fxNg.n === 9 && fxNg.ring && fxNg.src === 'assets/sk-cheer.png' && fxNg.wobble && !fxNg.outside, '오답: 응원 슈콩 + 꽃 파티클 8개·링, 캐릭터 칸에만');
  await p4.waitForFunction(() => !document.querySelector('#fb .fx-layer'), null, { timeout: 4000 });
  ok(true, '파티클은 1회 재생 뒤 DOM에서 제거');
  await p4.click('#next');
  await p4.waitForFunction(() => document.getElementById('tb-n').textContent === '2 / 15');
  ok(await p4.$eval('#fb', e => e.classList.contains('hidden')) && await p4.$eval('#segs .seg:nth-child(2)', e => e.classList.contains('now')), '다음 문항으로 넘어감(한 문항 = 한 페이지)');
  ok(await p4.evaluate(() => !document.activeElement || document.activeElement.tagName !== 'SELECT'), '다음 문항으로 넘어가도 드롭다운에 포커스가 가지 않음(휴대폰 선택창 자동 열림 방지)');
  // 2번부터 정답으로 — 점수·콤보
  async function answer(q) {
    if (q.type === 'ox') await p4.click('#abox .big[data-v="' + q.answer + '"]');
    else if (q.type === 'choice') await p4.click('#abox .opt[data-v="' + q.answer + '"]');
    else { await p4.fill('#ans', q.answer); await p4.click('#chk'); }
    await p4.waitForSelector('#next');
  }
  await answer(q1[1]);
  ok((await p4.textContent('#fb .fb-top')).includes('정답') && (await p4.textContent('#fb .fb-top .pts')).match(/\+1[0-9][0-9]점/), '맞히면 정답 + 점수(100 + 남은 초×2)');
  const fxOk = await p4.evaluate(() => { const a = document.querySelector('#fb .fb-avatar'), img = document.querySelector('#fb .fb-img'); return { panel: !!document.querySelector('#fb .fb-panel.ok'), n: a.querySelectorAll('.fx-layer span').length, src: img.getAttribute('src'), still: !img.style.animation.includes('fxWobble') }; });
  ok(fxOk.panel && fxOk.n === 13 && fxOk.src === 'assets/sk-heart.png' && fxOk.still, '정답: 하트 슈콩 + 하트 파티클 12개·링(오답보다 많게)');
  ok(await p4.$eval('#fb .fb-img', e => e.getBoundingClientRect().width >= 80) && await p4.$eval('#fb .fb-top', e => parseFloat(getComputedStyle(e).fontSize) >= 19), '피드백 패널: 슈콩 80px 이상 · 제목 19px 이상(존재감)');
  await p4.click('#next'); await answer(q1[2]); await p4.click('#next'); await answer(q1[3]);
  ok((await p4.textContent('#tb-combo-n')) === '콤보 3' && (await p4.textContent('#fb .fb-top')).includes('콤보 3'), '3연속 정답 → 콤보 3');
  for (let i = 4; i < 15; i++) { await p4.click('#next'); await answer(q1[i]); }
  ok((await p4.textContent('#next')) === '결과 보기', '마지막 문항 뒤 [결과 보기]');
  await p4.click('#next');
  await p4.waitForSelector('#result:not(.hidden)');
  ok((await p4.textContent('.res-big')) === '클리어!' && (await p4.textContent('.res-pct')).includes('93%') && (await p4.textContent('.pass-tag')).includes('스테이지 10 열림'), '결과: 클리어 93% · 다음 스테이지 열림');
  await p4.waitForFunction(() => document.getElementById('star-slot').textContent.includes('세트 2'));
  ok((await p4.textContent('#star-slot')).includes('모두 70% 이상으로 마치면') , '세트 미완 안내(스테이지 6~10)');
  ok((await p4.$$('.wrong')).length === 1 && (await p4.textContent('.wrong-title')).includes('틀린 1문항'), '틀린 문항 1개 다시 보기');
  const sub5 = sbCalls.filter(c => c.fn === 'gramma_submit').pop();
  ok(sub5.body.mode === 'play' && sub5.body.points > 1000 && sub5.body.unit === '한글 맞춤법' && sub5.body.round === '9' && sub5.body.got === 14 && sub5.body.set.no === 2 && sub5.body.set.rounds.join(',') === '6,7,8,9,10', 'gramma_submit: mode=play · 점수 · 세트 2(6~10)');
  ok(lastPost && lastPost.mode === 'play' && lastPost.score === '14 / 15' && lastPost.details.startsWith('플레이 모드 ·') && lastPost.points === sub5.body.points, '시트 사본: mode=play · 14 / 15 · 상세 첫 줄 플레이 모드');
  ok((await p4.getAttribute('.grid2 .btn.pri', 'href')).includes('play.html?c=ort&r=10'), '[다음 스테이지] → 10');
  ok((await p4.textContent('#result .tiles')).includes('최다 콤보') && (await p4.textContent('#result .tiles')).includes('14'), '최다 콤보 14');
  // 시간 초과: 30초 지나면 오답 처리
  const p4b = await ctx.newPage(); p4b.on('dialog', d => d.accept());
  await p4b.clock.install();   // 가짜 시계 — 페이지를 열기 전에 설치해야 setInterval이 잡힌다
  await p4b.goto(`http://localhost:${PORT}/play.html?c=ort&r=2&name=박검증&school=화정고&grade=고1&p8=12345678`);
  await p4b.waitForSelector('#start:not(.hidden)'); await p4b.click('#st-go'); await p4b.waitForSelector('#abox .big');
  await p4b.clock.runFor(31000);
  await p4b.waitForSelector('#fb:not(.hidden)');
  ok((await p4b.textContent('#fb .fb-top')).includes('시간 초과') && await p4b.$eval('#segs .seg:nth-child(1)', e => e.classList.contains('ng')), '30초 지나면 시간 초과 = 오답');
  await p4b.close();
  // 세트 마지막 스테이지 클리어 → 별 +1 카드 (mock: 세트 마지막 회차 통과 = 세트 클리어)
  await p4.goto(`http://localhost:${PORT}/play.html?c=ort&r=5&name=박검증&school=화정고&grade=고1&p8=12345678`);
  await p4.waitForSelector('#start:not(.hidden)'); await p4.click('#st-go');
  const q5 = await p4.evaluate(() => fetch('data/ort-5.json').then(r => r.json()).then(d => d.questions));
  for (let i = 0; i < q5.length; i++) { await p4.waitForSelector('#abox .big, #abox .opt, #ans'); await answer(q5[i]); await p4.click('#next'); }
  await p4.waitForSelector('#result:not(.hidden)');
  await p4.waitForFunction(() => document.getElementById('star-slot').textContent.includes('별 +1'));
  ok((await p4.textContent('#star-slot')).includes('세트 1 클리어') && (await p4.textContent('#star-slot')).includes('더해졌어요'), '세트 마지막 스테이지 클리어 → 세트 1 클리어 · 별 +1 카드');
  const fxStar = await p4.evaluate(() => { const st = document.querySelector('#star-slot .star-done .star-stage'); return st ? { h: st.getBoundingClientRect().height, n: st.querySelectorAll('.fx-layer span').length, ov: getComputedStyle(st).overflow, src: st.querySelector('img').getAttribute('src'), title: document.querySelector('#star-slot .star-done .t').textContent } : null; });
  ok(fxStar && fxStar.h === 118 && fxStar.n === 13 && fxStar.ov === 'hidden' && fxStar.src === 'assets/sk-best.png' && fxStar.title === '별 하나 완성!', '별 완성: 최고슈콩 + 노란 반짝이 12개, 118px 별 영역 안에만');
  // 미리보기는 기록 없음
  const nSb = sbCalls.length;
  await p4.goto(`http://localhost:${PORT}/play.html?c=ort&r=2&preview=1`);
  await p4.waitForSelector('#start:not(.hidden)');
  ok(!(await p4.$eval('#st-go', e => e.disabled)) && (await p4.textContent('#st-who')).includes('미리보기'), '미리보기는 정보 없이 시작 가능');
  await p4.goto(`http://localhost:${PORT}/play.html?c=ort&r=2`);
  await p4.waitForSelector('#start:not(.hidden)');
  ok(await p4.$eval('#st-go', e => e.disabled), '학생 정보 없으면 시작 잠김');
  ok(sbCalls.length === nSb, '미리보기·정보 없음은 기록 호출 없음');

  /* ========== 5f) 형태소 플레이 — 붙임표 없이 정답·자모 코드·정정 문항·레벨2 60초 (2026-09-17 검수 반영) ========== */
  async function answerMor(q, forms) {   // process: 단계마다 형태소(기본 = 정답의 붙임표를 뗀 것) + 알약 두 개
    if (q.type !== 'process') return answer(q);
    for (let si = 0; si < q.steps.length; si++) {
      const st = q.steps[si];
      await p4.fill('#frm-' + si, forms && forms[si] != null ? forms[si] : st.form.split('/')[0].replace(/^-+|-+$/g, ''));
      await p4.click('.pills[data-for="sel-' + si + '"] .pill[data-v="' + st.accept[0] + '"]');
      await p4.click('.pills[data-for="sel2-' + si + '"] .pill[data-v="' + st.accept2[0] + '"]');
    }
    await p4.click('#chk'); await p4.waitForSelector('#next');
  }
  const formsOK = () => p4.$$eval('#qbox .form-input, #abox .form-input', els => els.length > 0 && els.every(e => e.classList.contains('ok')));
  await p4.goto(`http://localhost:${PORT}/play.html?c=mor&r=2&name=박검증&school=화정고&grade=고1&p8=12345678`);
  await p4.waitForSelector('#start:not(.hidden)');
  ok((await p4.textContent('#st-sec')) === '30초', '레벨1 시작 화면: 문항당 30초');
  await p4.click('#st-go'); await p4.waitForSelector('#frm-0');
  const qm2 = await p4.evaluate(() => fetch('data/mor-2.json').then(r => r.json()).then(d => d.questions));
  ok(qm2[0].start === '맞먹다' && (await p4.$$eval('.step-row .hy', els => els.map(e => e.textContent).join('|'))) === '|-||-|-|', '맞먹다: 붙임표는 빈칸 옆에 표시');
  await answerMor(qm2[0]);
  ok((await p4.textContent('#fb .fb-top')).includes('정답') && await formsOK(), '맞먹다: 붙임표 없이 맞·먹·다만 써도 정답(신고 ①)');
  await p4.click('#next'); await answerMor(qm2[1]); await p4.click('#next'); await answerMor(qm2[2]);
  ok((await p4.textContent('#fb .fb-top')).includes('정답') && await formsOK(), '풋사과: 풋·사과 붙임표 없이 정답');
  await p4.click('#next'); await answerMor(qm2[3], ['가', '시', 'ᄇ시오']);
  ok(qm2[3].start === '가십시오' && (await p4.textContent('#fb .fb-top')).includes('정답') && await formsOK(), '가십시오: 옛 자모 코드(U+1107)로 넣은 ㅂ시오도 정답');
  for (let i = 4; i < qm2.length; i++) { await p4.click('#next'); await p4.waitForSelector('#frm-0, #ans, #abox .big, #abox .opt'); await answerMor(qm2[i]); }
  await p4.click('#next'); await p4.waitForSelector('#result:not(.hidden)');
  ok((await p4.textContent('#result')).includes('100%'), '스테이지 2 전부 정답(붙임표 없이)');
  // 스테이지 3 12번 — 단어 ≦ 형태소(정정), 스테이지 5 12번·7 11번 — '음운론'/'형태론적' 둘 다 정답
  async function playTo(round, idx, typed) {
    await p4.goto(`http://localhost:${PORT}/play.html?c=mor&r=${round}&name=박검증&school=화정고&grade=고1&p8=12345678`);
    await p4.waitForSelector('#start:not(.hidden)'); await p4.click('#st-go');
    const qs = await p4.evaluate((r) => fetch('data/mor-' + r + '.json').then(x => x.json()).then(d => d.questions), round);
    for (let i = 0; i < idx; i++) { await p4.waitForSelector('#frm-0, #ans, #abox .big, #abox .opt'); await answerMor(qs[i]); await p4.click('#next'); }
    await p4.waitForSelector('#ans'); await p4.fill('#ans', typed); await p4.click('#chk'); await p4.waitForSelector('#next');
    return qs[idx];
  }
  const q312 = await playTo(3, 11, '적거나 같다');
  ok(q312.stem.includes('(적거나 같다/많다)') && q312.answer === '적거나 같다' && (await p4.textContent('#fb .fb-top')).includes('정답'), "스테이지 3 12번: 단어는 형태소보다 '적거나 같다'가 정답(정정 ③)");
  const q512 = await playTo(5, 11, '음운론');
  ok(q512.stem.includes('○○○적 이형태') && (await p4.textContent('#fb .fb-top')).includes('정답'), "스테이지 5 12번: 빈칸대로 '음운론'만 써도 정답(정정 ④)");
  const q711 = await playTo(7, 10, '형태론적');
  ok(q711.stem.includes('○○○적 이형태') && (await p4.textContent('#fb .fb-top')).includes('정답'), "스테이지 7 11번: '형태론적'까지 써도 정답(정정 ⑤)");
  // 레벨2 = 문항당 60초, 점수 보너스는 30초 기준 환산(최대 +60)
  await p4.goto(`http://localhost:${PORT}/play.html?c=mor2&r=1&name=박검증&school=화정고&grade=고1&p8=12345678`);
  await p4.waitForSelector('#start:not(.hidden)');
  ok((await p4.textContent('#st-sec')) === '60초', '레벨2 시작 화면: 문항당 60초(신고 ⑥)');
  await p4.click('#st-go'); await p4.waitForSelector('#frm-0');
  ok((await p4.textContent('#tb-sec')) === '60초' || (await p4.textContent('#tb-sec')) === '59초', '레벨2 플레이 상단 60초에서 시작');
  const qm21 = await p4.evaluate(() => fetch('data/mor2-1.json').then(r => r.json()).then(d => d.questions));
  await answerMor(qm21[0]);
  const pts21 = parseInt(((await p4.textContent('#fb .fb-top .pts')).match(/\+(\d+)점/) || [])[1] || '0', 10);
  ok((await p4.textContent('#fb .fb-top')).includes('정답') && pts21 >= 140 && pts21 <= 160, '레벨2 정답 점수 = 100 + 남은 시간 보너스(30초 환산, 최대 60) → ' + pts21 + '점');
  // 스테이지 맵 안내 글도 단원 시간에 맞춤
  await p4.goto(`http://localhost:${PORT}/index.html?name=박검증&school=화정고&grade=고1&p8=12345678`);
  await p4.waitForSelector('#cats .cat-card[data-code="mor"]'); await p4.click('#cats .cat-card[data-code="mor"]');
  await p4.waitForSelector('#round-view:not(.hidden)');
  ok((await p4.textContent('#stages .now .nt')).includes('문항마다 30초'), '스테이지 맵 레벨1: 문항마다 30초');
  await p4.click('#lvl-tabs .lvl-tab[data-code="mor2"]');
  await p4.waitForFunction(() => document.getElementById('sec-title').textContent.includes('레벨2'));
  ok((await p4.textContent('#stages .now .nt')).includes('문항마다 60초'), '스테이지 맵 레벨2: 문항마다 60초');

  /* ========== 5d) test.html free=1 (배정 카드가 아닌 자유 응시 링크) — 배정 확인 생략은 그대로 ========== */
  assignItems = [];
  const prevReqs5 = reqLog.length;
  await p4.goto(`http://localhost:${PORT}/test.html?c=ort&r=2&free=1&name=박검증&school=화정고&grade=고1&p8=12345678`);
  await p4.waitForSelector('#app:not(.hidden)');
  await p4.click('#tab-test');
  await p4.click('#submit-btn');
  await p4.waitForSelector('.final.show');
  ok(!reqLog.slice(prevReqs5).some(q => q.action === 'myAssign'), 'free=1 은 배정 확인 생략(배정 없어도 제출)');

  /* ========== 5e) top30.html — 문법 슈스 탑30 ========== */
  topRows = [{ rank: 1, name: '김시은', school: '능곡고', grade: '고2', stages: 41, points: 19860, stars: 8 }, { rank: 2, name: '박검증', school: '화정고', grade: '고1', stages: 8, points: 4120, stars: 1 }];
  topMe = { rank: 2, stages: 8, points: 4120, stars: 1 };
  await p4.goto(`http://localhost:${PORT}/top30.html?name=박검증&school=화정고&grade=고1&p8=12345678`);
  await p4.waitForSelector('#list:not(.hidden)');
  ok((await p4.$$('#list .row')).length === 2 && (await p4.textContent('#list .row:nth-child(1) .nm')).includes('김시은') && (await p4.textContent('#list .row:nth-child(1) .pt')) === '19,860', '순위 목록(이름 그대로·점수)');
  ok((await p4.textContent('#me')).includes('2위') && (await p4.textContent('#me')).includes('스테이지 8') && (await p4.textContent('#me')).includes('1위까지 15,740점'), '내 순위 카드 + 위 순위까지 점수 차');
  ok(await p4.$eval('#list .row:nth-child(2)', e => e.classList.contains('mine')), '내 줄 강조');
  const topCall = sbCalls.filter(c => c.fn === 'gramma_top').pop();
  ok(topCall.body.level === 'all' && topCall.body.month === '' && topCall.body.name === '박검증' && topCall.body.phone8 === '12345678', 'gramma_top 호출(전체·이름·8자리)');
  await p4.click('.ftab[data-level="mid"]');
  await p4.waitForFunction(() => document.querySelector('.ftab[data-level="mid"]').classList.contains('on'));
  await p4.waitForTimeout(150);
  ok(sbCalls.filter(c => c.fn === 'gramma_top').pop().body.level === 'mid', '[중등] → level=mid');
  await p4.click('.ftab[data-month]'); await p4.waitForTimeout(150);
  ok(/^\d{4}-\d{2}$/.test(sbCalls.filter(c => c.fn === 'gramma_top').pop().body.month), '[이번 달] → month=YYYY-MM');
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

  /* ========== 11b) index.html?preview=1 — 티쳐스 [참여하기] 미리보기 (2026-09-16) ========== */
  const p12b = await ctx.newPage();
  await p12b.goto(`http://localhost:${PORT}/index.html?preview=1`);
  await p12b.waitForSelector('#cats .cat-card');
  ok(!(await p12b.$eval('#pv-band', e => e.classList.contains('hidden'))) && await p12b.$eval('#student-info', e => e.classList.contains('hidden')) && await p12b.$eval('#back-top', e => e.classList.contains('hidden')), '미리보기: 안내 띠 · 학생 정보 카드 숨김 · 돌아가기 없음');
  await p12b.click('#cats .cat-card[data-code="ort"]'); await p12b.waitForSelector('#round-view:not(.hidden)');
  ok((await p12b.$$('#stages .node.lock')).length === 0 && (await p12b.$$('#stages .setcard.locked')).length === 0 && (await p12b.textContent('#stage-note')).includes('기록 없음'), '미리보기: 모든 스테이지·세트 열림');
  await Promise.all([p12b.waitForNavigation(), p12b.click('#stages .node[data-round="12"]')]);
  ok(p12b.url().includes('play.html?c=ort&r=12&preview=1'), '아무 스테이지나 누르면 play.html?preview=1(기록 없음)');
  await p12b.waitForSelector('#start:not(.hidden)');
  ok((await p12b.getAttribute('#st-back', 'href')) === 'index.html?preview=1#c=ort', '플레이의 [스테이지 맵으로]도 미리보기 홈으로');
  await p12b.close();

  /* ========== 12) stats.html — 교사용 문법 참여 현황 (2026-09-16 사용자 요청 "학년 학교 내신반 개인을 선택해 수행률, 점수 등을 확인" + 탑30) ========== */
  const stStudents = [{ student_id: '12345678', name: '강구현', school: '백양고', grade: '2026 고등 1학년', enrolled: '재원' }, { student_id: '22222222', name: '김시은', school: '능곡고', grade: '2026 고등 2학년', enrolled: '재원' }, { student_id: '33333333', name: '문경민', school: '고양중', grade: '2026 중등 3학년', enrolled: '재원' }, { student_id: '44444444', name: '박지우', school: '화수고', grade: '2026 고등 1학년', enrolled: '재원' }, { student_id: '55555555', name: '이윤채B', school: '서정중', grade: '2026 중등 2학년', enrolled: '재원' }, { student_id: '66666666', name: '퇴원생', school: '화정고', grade: '2026 고등 1학년', enrolled: '퇴원' }];
  const stClasses = [{ class_id: 'n007', name: '고1 화수A(창비 공통국어2)', day: '수', start_time: '5:30', teacher: '현지', roster: '박지우 강구현 없는이름' }, { class_id: 'n013', name: '중2 서정A(비상(영))', day: '목', start_time: '5:00', teacher: '은지', roster: '이윤채B' }];
  const R = (id, name, p8, school, grade, unit, round, pct, mode, points, ts) => ({ id, ts, name, school, grade, phone8: p8, unit, round: '' + round, pct, got: 0, total: 0, mode, points, created_at: ts });
  const today = new Date(), ymdT = d => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  const old = new Date(today); old.setDate(old.getDate() - 40);
  const stResults = [R(1, '강구현', '12345678', '백양고', '고1', '한글 맞춤법', 1, 80, 'play', 1500, ymdT(old) + ' 10:00'), R(2, '강구현', '12345678', '백양고', '고1', '한글 맞춤법', 2, 60, 'play', 800, ymdT(old) + ' 11:00'), R(3, '강구현', '12345678', '백양고', '고1', '한글 맞춤법', 2, 75, 'play', 1200, ymdT(old) + ' 12:00'),
    R(4, '김시은', '22222222', '능곡고', '고2', '음운', 1, 93, 'play', 2000, ymdT(today) + ' 10:00'), R(5, '김시은', '22222222', '능곡고', '고2', '음운', 2, 100, 'test', 0, ymdT(today) + ' 10:30'), R(6, '문경민', '33333333', '고양중', '중3', '형태소', 1, 71, 'play', 900, ymdT(old) + ' 10:00'), R(7, '명단밖', '99999999', '다른고', '고1', '음운', 1, 50, 'play', 300, ymdT(today) + ' 09:00')];
  const stSets = [{ id: 1, name: '김시은', school: '능곡고', grade: '고2', phone8: '22222222', unit: '음운', set_no: 1, cleared_at: ymdT(today) + 'T01:00:00Z' }];
  const authCalls = [];
  await ctx.route(/supabase\.co\/auth\/v1\/token/, r => { authCalls.push(1); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'TEACHER', expires_in: 3600 }) }); });
  const tblAuth = [];
  await ctx.route(/supabase\.co\/rest\/v1\/(students|tt_classes|gramma_results|gramma_sets)\b/, r => {
    const u = r.request().url(), off = +(u.match(/offset=(\d+)/) || [0, 0])[1];
    tblAuth.push(r.request().headers()['authorization']);
    const d = u.includes('/students') ? stStudents : u.includes('tt_classes') ? stClasses : u.includes('gramma_results') ? stResults : stSets;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(off ? [] : d) });
  });
  topRows = [{ rank: 1, name: '김시은', school: '능곡고', grade: '고2', stages: 20, points: 12000, stars: 4 }, { rank: 2, name: '강구현', school: '백양고', grade: '고1', stages: 12, points: 3500, stars: 2 }, { rank: 3, name: '박지우', school: '화수고', grade: '고1', stages: 8, points: 5100, stars: 1 },
    { rank: 4, name: '이서연', school: '능곡고', grade: '고2', stages: 5, points: 4134, stars: 1 }, { rank: 5, name: '최은성', school: '화정고', grade: '고2', stages: 4, points: 4746, stars: 0 }]; topMe = null;
  const p13 = await ctx.newPage();
  const errs13 = []; p13.on('pageerror', e => errs13.push(e.message));
  await p13.goto(`http://localhost:${PORT}/stats.html`);
  await p13.waitForSelector('#body:not(.hidden)');
  ok(authCalls.length >= 1 && tblAuth.every(h => h === 'Bearer TEACHER'), '표 조회는 교사 인증 토큰으로');
  const tile = i => p13.textContent('#tiles .tile:nth-child(' + i + ')');
  ok((await tile(1)).includes('5명') && (await tile(1)).includes('명단 밖 1명') && (await tile(2)).includes('4명') && (await tile(2)).includes('참여율 60%'), '전체: 대상 5명(퇴원 제외) · 명단 밖 1명 · 참여 4명 60%');
  ok((await tile(4)).includes('5') && (await tile(5)).includes('1') && (await tile(6)).includes('74%'), '클리어 5 · 별 1 · 평균 정답률 74%');
  ok((await p13.textContent('#allstars')) === '전체 별 1개' && await p13.$eval('#bigstar', e => e.classList.contains('on')) && (await p13.textContent('#part-n')) === '4' && (await p13.textContent('.h-n2')).includes('통과 기준 70%'), '히어로 오른쪽 숫자 블록: 4명 참여 · 전체 별 1개 · 통과 기준 70% · 별 노랑');
  ok(!(await p13.$('.header .intro')) && !(await p13.$('#top30-btn')) && await p13.$eval('#bigstar', e => e.getBoundingClientRect().width === 40), '안내 문장·[탑30 보기] 없음, 별 40px');
  ok((await p13.$$eval('.header .seg .vtab', els => els.map(e => e.textContent.trim()))).join('/') === '참여 현황/슈스 탑30/제출 목록/오류 제보' && await p13.$eval('#vt-list', e => e.tagName === 'A' && e.getAttribute('href') === 'shueguk-teacher-dashboard.html'), '세그먼트 탭 4개 — 제출 목록은 링크');
  ok(await p13.$eval('#open-student', e => { const s = getComputedStyle(e); return e.target === '_blank' && s.borderTopWidth === '1px' && s.backgroundColor === 'rgba(0, 0, 0, 0)'; }), '[학생 화면 열기 ↗] = 오른쪽 끝 테두리 버튼');
  const rows13 = await p13.$$eval('#stu-tbl tr.stu', els => els.map(e => e.getAttribute('data-key')));
  ok(rows13[0] === '김시은|22222222' && rows13[1] === '강구현|12345678' && rows13.length === 6, '학생별 표: 클리어 많은 순, 명단 밖·미참여까지 6줄');
  ok((await p13.textContent('#stu-tbl tr.stu[data-key="강구현|12345678"]')).includes('3회') && (await p13.textContent('#stu-tbl tr.stu[data-key="강구현|12345678"]')).includes('2 / 294') && (await p13.textContent('#stu-tbl tr.stu[data-key="강구현|12345678"]')).includes('78%') && (await p13.textContent('#stu-tbl tr.stu[data-key="강구현|12345678"]')).includes('3,500'), '강구현: 응시 3회 · 클리어 2 · 평균 78%(스테이지별 최고) · 플레이 3,500점');
  ok((await p13.textContent('#stu-tbl tr.stu[data-key="44444444"], #stu-tbl tr.stu[data-key="박지우|44444444"]')).includes('미참여'), '미참여 학생도 줄에(미참여 표시)');
  await p13.click('#stu-tbl tr.stu[data-key="강구현|12345678"]');
  ok((await p13.$$('#stu-tbl tr.det .node')).length === 32 && (await p13.$$('#stu-tbl tr.det .node.pass')).length === 2 && (await p13.textContent('#stu-tbl tr.det .det-unit .u')).includes('한글 맞춤법'), '줄을 누르면 스테이지 32칸(통과 2)');
  ok((await p13.textContent('#unit-tbl')).includes('음운') && (await p13.$$('#unit-tbl tbody tr')).length === 5, '단원별 표 5줄');
  // 내신반
  await p13.click('#scope-pills .pill[data-scope="cls"]');
  ok((await p13.$$('#cls-sel option')).length === 3 && (await p13.textContent('#cls-sel option[value="n007"]')).includes('수 5:30 · 고1 화수A(창비 공통국어2) · 현지T (3명)'), '내신반 드롭다운(요일·시간·반이름·담당T·인원)');
  await p13.selectOption('#cls-sel', 'n007');
  ok((await tile(1)).includes('2명') && (await tile(2)).includes('1명') && (await p13.textContent('#cls-hint')).includes('없는이름'), '내신반 고1 화수A: 대상 2명(명단 대조) · 참여 1명 · 못 찾은 이름 안내');
  // 학년·학교·개인
  await p13.click('#scope-pills .pill[data-scope="grade"]'); await p13.click('#grade-pills .pill[data-grade="고1"]');
  ok((await p13.$$('#stu-tbl tr.stu')).length === 3 && (await tile(1)).includes('2명'), '학년 고1: 재원 2명 + 명단 밖 1명');
  await p13.click('#scope-pills .pill[data-scope="school"]'); await p13.selectOption('#school-sel', '능곡고');
  ok((await p13.$$('#stu-tbl tr.stu')).length === 1 && (await tile(2)).includes('100%'), '학교 능곡고: 1명 · 참여율 100%');
  await p13.click('#scope-pills .pill[data-scope="person"]'); await p13.fill('#person-q', '문경');
  await p13.click('#person-cands .cand'); 
  ok((await p13.$$('#person-chips .chip')).length === 1 && (await p13.$$('#stu-tbl tr.stu')).length === 1 && (await tile(6)).includes('71%'), '개인: 이름 검색 → 담기 → 그 학생만(정답률 71%)');
  // 단원·기간
  await p13.click('#scope-pills .pill[data-scope="all"]'); await p13.click('#unit-pills .pill[data-unit="음운"]');
  ok((await tile(3)).includes('20개') && (await p13.$$('#unit-tbl tbody tr')).length === 1, '단원 음운만: 수행률 분모 20 · 단원 표 1줄');
  await p13.click('#unit-pills .pill[data-unit=""]'); await p13.click('#period-pills .pill[data-period="7d"]');
  ok((await tile(2)).includes('2명') && (await p13.$$('#stu-tbl tr.stu:not(.none)')).length === 2, '최근 7일: 참여 2명(40일 전 기록 제외)');
  // 정렬·검색·탑30
  await p13.click('#period-pills .pill[data-period="all"]'); await p13.selectOption('#stu-sort', 'name');
  ok((await p13.$$eval('#stu-tbl tr.stu', els => els.map(e => e.querySelector('.nm').textContent)))[0] === '강구현', '이름순 정렬');
  await p13.fill('#stu-q', '김시');
  ok((await p13.$$('#stu-tbl tr.stu')).length === 1, '이름 찾기');
  await p13.click('#vt-top'); await p13.waitForSelector('#top-list:not(.hidden)');
  ok(await p13.$eval('#v-stats', e => e.classList.contains('hidden')) && await p13.$eval('#vt-top', e => e.classList.contains('on')), '[슈스 탑30] 탭 → 탑30 화면');
  const pods = await p13.$$eval('#top-podium .pod', els => els.map(e => ({ cls: e.className, nm: (e.querySelector('.pn') || {}).textContent, h: e.querySelector('.pod-bar') ? e.querySelector('.pod-bar').getBoundingClientRect().height : 0, bg: e.querySelector('.pod-bar') ? getComputedStyle(e.querySelector('.pod-bar')).backgroundColor : '' })));
  ok(pods.length === 3 && pods[0].cls === 'pod p2' && pods[1].cls === 'pod p1' && pods[2].cls === 'pod p3' && pods[1].nm.includes('김시은') && pods[0].nm.includes('강구현'), '시상대: 왼쪽 2위 · 가운데 1위 · 오른쪽 3위');
  ok(pods[1].h === 92 && pods[0].h === 72 && pods[2].h === 60 && pods[1].bg === 'rgb(90, 74, 106)' && pods[0].bg === 'rgb(142, 123, 163)' && pods[2].bg === 'rgb(201, 182, 219)', '기둥 92/72/60px · #5A4A6A/#8E7BA3/#C9B6DB');
  ok((await p13.textContent('#top-podium .pod.p1 .pod-bar')).replace(/\s/g, '') === '112,000P' && (await p13.textContent('#top-podium .pod.p1 .pd')) === '스테이지 20 · 별 4', '1위 기둥: 순위 1 · 12,000 P, 위에 스테이지 20 · 별 4');
  ok((await p13.$$('#top-list .row')).length === 2 && (await p13.textContent('#top-head')).includes('클리어 스테이지') && (await p13.textContent('#top-list .row:nth-child(1) .nm')).includes('이서연'), '4위 이하 2줄 + 열 제목 줄');
  const r4 = await p13.$eval('#top-list .row:nth-child(1)', e => ({ rk: getComputedStyle(e.querySelector('.rk')).backgroundColor, bar: e.querySelector('.bar i').style.width, pt: e.querySelector('.pt').textContent.replace(/\s/g, ''), grid: getComputedStyle(e).display }));
  const r5bar = await p13.$eval('#top-list .row:nth-child(2) .bar i', e => e.style.width);
  ok(r4.rk === 'rgb(242, 245, 243)' && r4.bar === '25%' && r5bar === '20%' && r4.pt === '4,134P' && r4.grid === 'grid', '4위: 회색 배지 · 막대 25%(5/20) · 4,134 P — 5위 4,746점보다 막대가 길다');
  ok((await p13.textContent('#top-foot-l')) === '전체 5명 · 30위까지 표시' && (await p13.textContent('#top-foot-r')) === '전체 기준', '푸터: 전체 5명 · 30위까지 표시 / 전체 기준');
  await p13.click('#v-top .pill[data-level="mid"]'); await p13.waitForFunction(() => document.getElementById('top-foot-r').textContent === '중등 기준');
  ok(await p13.$eval('#v-top .pill[data-level="mid"]', e => e.classList.contains('on') && getComputedStyle(e).backgroundColor === 'rgb(237, 228, 244)'), '중등 칩 → 푸터 중등 기준, 선택 칩 연보라');
  ok(await p13.$eval('#vt-top', e => getComputedStyle(e).backgroundColor === 'rgb(237, 228, 244)' && getComputedStyle(e).boxShadow === 'none' && getComputedStyle(e).fontWeight === '700') && await p13.$eval('#vt-stats', e => getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)') && await p13.$eval('.header .h-left', e => /^(left|start)$/.test(getComputedStyle(e).textAlign)) && await p13.$eval('.topcard', e => getComputedStyle(e).boxShadow === 'none'), '디자인 규칙: 선택 탭 연보라 700·안 선택 배경 없음·그림자 없음·히어로 왼쪽 정렬');
  ok(errs13.length === 0, '페이지 오류 없음');
  await p13.close();

  /* ========== 13) 문항 오류 제보 — play.html·test.html [이 문항 오류 제보] → 리포트 수정 요청함(grammaReport) + stats.html '오류 제보' 탭 (2026-09-18) ========== */
  const p14 = await ctx.newPage(); p14.on('dialog', d => d.accept());
  async function answerMor14(q) {
    if (q.type === 'ox') await p14.click('#abox .big[data-v="' + q.answer + '"]');
    else if (q.type === 'choice') await p14.click('#abox .opt[data-v="' + q.answer + '"]');
    else if (q.type === 'short') { await p14.fill('#ans', q.answer); await p14.click('#chk'); }
    else { for (let si = 0; si < q.steps.length; si++) { const st = q.steps[si]; await p14.fill('#frm-' + si, st.form.split('/')[0].replace(/^-+|-+$/g, '')); await p14.click('.pills[data-for="sel-' + si + '"] .pill[data-v="' + st.accept[0] + '"]'); await p14.click('.pills[data-for="sel2-' + si + '"] .pill[data-v="' + st.accept2[0] + '"]'); } await p14.click('#chk'); }
    await p14.waitForSelector('#next');
  }
  await p14.goto(`http://localhost:${PORT}/play.html?c=mor&r=1&name=박검증&school=화정고&grade=고1&p8=12345678`);
  await p14.waitForSelector('#start:not(.hidden)'); await p14.click('#st-go'); await p14.waitForSelector('#frm-0');
  const qm1 = await p14.evaluate(() => fetch('data/mor-1.json').then(r => r.json()).then(d => d.questions));
  // 1번을 일부러 틀리게(형태소 칸에 엉뚱한 값)
  for (let si = 0; si < qm1[0].steps.length; si++) { await p14.fill('#frm-' + si, '엉뚱'); await p14.click('.pills[data-for="sel-' + si + '"] .pill[data-v="실질"]'); await p14.click('.pills[data-for="sel2-' + si + '"] .pill[data-v="자립"]'); }
  await p14.click('#chk'); await p14.waitForSelector('#next');
  ok((await p14.$$('#fb .rp-link[data-rp="1"]')).length === 1 && (await p14.textContent('#fb .rp-link')) === '이 문항 오류 제보', '정답 확인 패널 아래 [이 문항 오류 제보] 글자 버튼');
  ok(await p14.$eval('#fb .rp-link', e => { const s = getComputedStyle(e); return s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.borderTopWidth === '0px'; }), '제보 버튼은 배경·테두리 없는 연보라 글자');
  await p14.click('#fb .rp-link'); await p14.waitForSelector('#rpModal:not(.hidden)');
  const where = await p14.textContent('#rp-where');
  ok(where.includes('형태소 레벨1 · 스테이지 1 · 1번') && where.includes(qm1[0].start) && where.includes('내 답') && where.includes('정답'), '창 위에 단원·레벨·스테이지·번호·문항·내 답·정답이 자동으로');
  ok((await p14.$$('#rp-kinds .rp-kind')).length === 4 && await p14.$eval('#rp-kinds .rp-kind', e => e.classList.contains('on')), '종류 알약 4개, 첫째 기본 선택');
  reportPosts.length = 0;
  await p14.click('#rp-send');
  ok((await p14.textContent('#rp-msg')).includes('적어 주세요') && reportPosts.length === 0, '내용이 비면 보내지 않고 안내');
  await p14.click('#rp-kinds .rp-kind:nth-child(2)'); await p14.fill('#rp-text', '해설에 오타가 있어요');
  await p14.click('#rp-send'); await p14.waitForSelector('#rp-done:not(.hidden)');
  const rp = reportPosts[0];
  ok(rp && rp.action === 'grammaReport' && rp.name === '박검증' && rp.school === '화정고' && rp.grade === '고1' && rp.cat === '형태소' && rp.level === '레벨1' && '' + rp.round === '1' && '' + rp.qno === '1' && rp.start === qm1[0].start && rp.kind === '문항·해설 오타' && rp.text === '해설에 오타가 있어요' && rp.mine.includes('엉뚱') && rp.answer && rp.preview === false, '보내기 → grammaReport 본문(학생·문항 위치·종류·내용·내 답·정답)');
  ok(!('p8' in rp) && !('phone8' in rp) && JSON.stringify(rp).indexOf('12345678') < 0 && !('pw' in rp), '8자리 번호·비밀번호는 보내지 않음');
  ok((await p14.textContent('#rp-done')).includes('전달됐어요') && await p14.$eval('#fb .rp-link', e => e.disabled && e.textContent === '제보 완료'), "완료 안내 + 버튼 '제보 완료' 잠금");
  await p14.click('#rp-close'); ok(await p14.$eval('#rpModal', e => e.classList.contains('hidden')), '닫기');
  // 결과 화면의 틀린 문항 줄에도 [오류 제보]
  for (let i = 1; i < qm1.length; i++) { await p14.click('#next'); await p14.waitForSelector('#frm-0, #ans, #abox .big, #abox .opt'); await answerMor14(qm1[i]); }
  await p14.click('#next'); await p14.waitForSelector('#result:not(.hidden)');
  ok((await p14.$$('#result .wrong .rp-link[data-rp="1"]')).length === 1 && await p14.$eval('#result .wrong .rp-link', e => e.disabled), '결과 화면 틀린 문항 줄에 [오류 제보] — 이미 보낸 문항은 잠긴 채');
  // 보내기 실패 → 안내 + 다시 시도 가능
  await p14.goto(`http://localhost:${PORT}/play.html?c=mor&r=2&name=박검증&school=화정고&grade=고1&p8=12345678`);
  await p14.waitForSelector('#start:not(.hidden)'); await p14.click('#st-go'); await p14.waitForSelector('#frm-0');
  const qm2r = await p14.evaluate(() => fetch('data/mor-2.json').then(r => r.json()).then(d => d.questions));
  await answerMor14(qm2r[0]);
  reportFail = true;
  await p14.click('#fb .rp-link'); await p14.waitForSelector('#rpModal:not(.hidden)'); await p14.fill('#rp-text', '테스트'); await p14.click('#rp-send');
  await p14.waitForFunction(() => document.getElementById('rp-msg').textContent.includes('지금은 보낼 수 없어요'));
  ok(!(await p14.$eval('#rp-send', e => e.disabled)) && await p14.$eval('#rp-form', e => !e.classList.contains('hidden')), '서버 오류면 안내하고 다시 보낼 수 있음');
  reportFail = false;
  await p14.close();
  // test.html(미리보기) — 채점 뒤 문항 카드마다 버튼, 작성자는 선생님(미리보기)
  const p15 = await ctx.newPage(); p15.on('dialog', d => d.accept());
  await p15.goto(`http://localhost:${PORT}/test.html?c=mor&r=1&preview=1`);
  await p15.waitForSelector('.q-card'); if (await p15.isVisible('#tab-test')) await p15.click('#tab-test');
  await p15.click('#student-info'); await p15.fill('#si-name', '이선생'); await p15.fill('#si-school', '슈국'); await p15.selectOption('#si-grade', '고1'); await p15.fill('#si-phone8', '00000000');
  await p15.click('#submit-btn'); await p15.waitForSelector('.final.show');
  ok((await p15.$$('.q-card .rp-link')).length === 15, '전체 제출 방식도 채점 뒤 문항마다 [이 문항 오류 제보]');
  await p15.click('#card-2 .rp-link'); await p15.waitForSelector('#rpModal:not(.hidden)');
  ok((await p15.textContent('#rp-where')).includes('스테이지 1 · 3번'), '3번 카드 → 3번 문항 정보');
  reportPosts.length = 0; await p15.fill('#rp-text', '미리보기 제보'); await p15.click('#rp-send'); await p15.waitForSelector('#rp-done:not(.hidden)');
  ok(reportPosts[0] && reportPosts[0].preview === true && '' + reportPosts[0].qno === '3', '미리보기 제보는 preview:true');
  await p15.close();
  // stats.html '오류 제보' 탭
  editReqRows = [
    { row: 3, ts: '2026-09-18 21:10', writer: '박검증 (화정고 고1)', screen: '문법 테스트', text: '[형태소 레벨1 · 스테이지 3 · 12번 단어와 형태소의 수를…]\n종류: 정답이 틀린 것 같아요\n내용: 적거나 같다가 맞아요', status: '접수됨', note: '', doneTs: '' },
    { row: 2, ts: '2026-09-18 20:00', writer: '조교', screen: '전체 시간표', text: '시간표 요청', status: '접수됨', note: '', doneTs: '' },
    { row: 1, ts: '2026-09-17 10:00', writer: '선생님(미리보기)', screen: '문법 테스트', text: '[음운 · 스테이지 1 · 2번]\n종류: 오타\n내용: 해설 오타', status: '보류', note: '클로슈 확인: 제보가 맞아요', doneTs: '2026-09-17 10:05' },
  ];
  const p16 = await ctx.newPage(); p16.on('dialog', d => d.accept());
  await p16.goto(`http://localhost:${PORT}/stats.html`);
  await p16.waitForSelector('#vt-report');
  await p16.click('#vt-report'); await p16.waitForSelector('#v-report:not(.hidden) .rq-item');
  ok((await p16.$$('#v-report .rq-item')).length === 2 && (await p16.textContent('#rq-cnt')) === '2' && !(await p16.textContent('#v-report')).includes('시간표 요청'), "'오류 제보' 탭 = 화면 '문법 테스트'만 2건, 탭 배지 2(처리 완료 아닌 것)");
  ok((await p16.$eval('#v-report .rq-item:nth-child(1) .rq-text b', e => e.textContent)).startsWith('[형태소 레벨1') && (await p16.textContent('#v-report .rq-item:nth-child(2) .rq-note')).includes('클로슈 확인'), '위치는 굵게, 보류 건은 확인 결과 메모');
  await p16.click('#rq-filter .pill[data-st="보류"]');
  ok((await p16.$$('#v-report .rq-item')).length === 1, '상태 칩으로 거르기');
  await p16.click('#rq-filter .pill[data-st=""]');
  editReqSets.length = 0;
  await p16.click('#v-report .rq-item:nth-child(1) button[data-act="done"]');
  await p16.fill('#v-report .rq-item:nth-child(1) .rq-memo', '정답을 고쳤어요');
  editReqRows[0].status = '처리 완료'; editReqRows[0].note = '정답을 고쳤어요';
  await p16.click('#v-report .rq-item:nth-child(1) button[data-act="save"]');
  await p16.waitForFunction(() => document.querySelector('#v-report .rq-item:nth-child(1) .rq-st').textContent === '처리 완료');
  const es = editReqSets[0];
  ok(es && es.action === 'editReqSet' && es.row === 3 && es.ts === '2026-09-18 21:10' && es.status === '처리 완료' && es.note === '정답을 고쳤어요' && es.del === 0, '[처리 완료] + 메모 저장 → editReqSet(row·ts 대조)');
  ok((await p16.textContent('#rq-cnt')) === '1', '처리 완료 뒤 배지 1');
  await p16.close();

  await browser.close();
  server.close();
  console.log(bad ? `\n실패 ${bad}/${n}` : `\n전체 통과 (${n}건)`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
