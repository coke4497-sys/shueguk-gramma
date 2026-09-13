/* 음운(pho) process 문항 정합성 검사 — knowledge/pho-02-음운변동.md §7·§8 기준.
 *   - 단계마다 고른 규칙과 실제 형태 변화가 맞는지(한글 자모 분해로 대조)
 *   - 최종 발음의 받침이 7개 대표음뿐인지
 *   - 미결 순서 유형(겹받침+된소리 / ㄴ 첨가와 끝소리 규칙 / 연음 단계)의 건수
 *   - 회차를 넘나드는 start 단어 중복
 *   실행: node tools/pho-audit.js  (규칙·형태 불일치나 최종 발음 오류가 있으면 종료 코드 1)
 *   기존 데이터에서 알려진 예외는 ALLOW에 적어 둔다(사용자 결정이 난 것만).
 *   연음은 규칙이 아니지만 항상 별도 단계로 둔다(2026-09-13 사용자 결정) — 규칙 단계의 결과에 연음을 녹이면 불일치로 잡는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'data');

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const CLUSTER = { 'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄶ': ['ㄴ', 'ㅎ'], 'ㄺ': ['ㄹ', 'ㄱ'], 'ㄻ': ['ㄹ', 'ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'], 'ㄽ': ['ㄹ', 'ㅅ'], 'ㄾ': ['ㄹ', 'ㅌ'], 'ㄿ': ['ㄹ', 'ㅍ'], 'ㅀ': ['ㄹ', 'ㅎ'], 'ㅄ': ['ㅂ', 'ㅅ'] };
const REP7 = { 'ㄲ': 'ㄱ', 'ㅋ': 'ㄱ', 'ㅅ': 'ㄷ', 'ㅆ': 'ㄷ', 'ㅈ': 'ㄷ', 'ㅊ': 'ㄷ', 'ㅌ': 'ㄷ', 'ㅎ': 'ㄷ', 'ㅍ': 'ㅂ' };
const NASAL = { 'ㄱ': 'ㅇ', 'ㄷ': 'ㄴ', 'ㅂ': 'ㅁ' };
const TENSE = { 'ㄱ': 'ㄲ', 'ㄷ': 'ㄸ', 'ㅂ': 'ㅃ', 'ㅅ': 'ㅆ', 'ㅈ': 'ㅉ' };
const ASP = { 'ㄱ': 'ㅋ', 'ㄷ': 'ㅌ', 'ㅂ': 'ㅍ', 'ㅈ': 'ㅊ' };
const SIMPLIFY = { 'ㄳ': ['ㄱ'], 'ㄵ': ['ㄴ'], 'ㄶ': ['ㄴ'], 'ㄺ': ['ㄱ', 'ㄹ'], 'ㄻ': ['ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'], 'ㄽ': ['ㄹ'], 'ㄾ': ['ㄹ'], 'ㄿ': ['ㅂ', 'ㅍ'], 'ㅀ': ['ㄹ'], 'ㅄ': ['ㅂ'] };
const YJUNG = 'ㅣㅑㅕㅛㅠㅒㅖ';
const FINAL_OK = ['', 'ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅇ'];

function normStart(str) { // '안- + -다' → '안다', '(신을)신기다' → '신기다', '잠자리(이불)' → '잠자리'
  return ('' + str).replace(/\([^)]*\)/g, '').replace(/[-+\s]/g, '');
}
function dec(str) { // 한글 음절만 [cho,jung,jong]로, 그 외 글자는 null(경계)
  const out = [];
  for (const ch of str) {
    const c = ch.charCodeAt(0) - 0xAC00;
    if (c < 0 || c > 11171) { out.push(null); continue; }
    out.push([CHO[Math.floor(c / 588)], JUNG[Math.floor((c % 588) / 28)], JONG[c % 28]]);
  }
  return out;
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function diffIdx(A, B) { const d = []; for (let i = 0; i < A.length; i++) if (!same(A[i], B[i])) d.push(i); return d; }
function jamoCount(A) { let n = 0; for (const s of A) { if (!s) continue; n += 2; if (s[2]) n += (CLUSTER[s[2]] ? 2 : 1); } return n; }

// 규칙마다: 이전 형태(A)→이번 형태(B)가 그 규칙으로 설명되면 null, 아니면 이유 문자열
const CHECK = {
  '변동 없음': (A, B) => same(A, B) ? null : '형태가 바뀜',
  '음절의 끝소리 규칙': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    const d = diffIdx(A, B); if (!d.length) return '바뀐 곳 없음';
    for (const i of d) {
      const a = A[i], b = B[i]; if (!a || !b) return '한글 아님';
      if (a[0] !== b[0] || a[1] !== b[1]) return `${i + 1}음절 초성·중성이 바뀜`;
      const want = REP7[a[2]] || (CLUSTER[a[2]] ? REP7[CLUSTER[a[2]][1]] ? CLUSTER[a[2]][0] + REP7[CLUSTER[a[2]][1]] : null : null);
      if (b[2] !== (REP7[a[2]] || '')) {
        // 겹받침 안의 둘째 자음만 대표음으로(ㄾ→ㄼ 같은 세밀 분석)은 허용하지 않음 — 데이터에 없음
        return `받침 ${a[2] || '∅'}→${b[2] || '∅'}은 대표음 교체가 아님`;
      }
    }
    return null;
  },
  '비음화': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    const d = diffIdx(A, B); if (!d.length) return '바뀐 곳 없음';
    for (const i of d) {
      const a = A[i], b = B[i]; if (!a || !b) return '한글 아님';
      if (a[1] !== b[1]) return '중성이 바뀜';
      if (a[2] !== b[2]) { // 받침 ㄱㄷㅂ→ㅇㄴㅁ, 뒤 초성이 ㄴ/ㅁ
        if (NASAL[a[2]] !== b[2]) return `받침 ${a[2]}→${b[2]}은 비음화가 아님`;
        const nx = B[i + 1]; if (!nx || 'ㄴㅁ'.indexOf(nx[0]) < 0) return '뒤에 비음(ㄴ·ㅁ)이 없음';
      }
      if (a[0] !== b[0]) { // ㄹ 비음화: 초성 ㄹ→ㄴ, 앞 받침 있음
        if (!(a[0] === 'ㄹ' && b[0] === 'ㄴ')) return `초성 ${a[0]}→${b[0]}은 비음화가 아님`;
        const pv = A[i - 1]; if (!pv || !pv[2] || pv[2] === 'ㄹ') return 'ㄹ 비음화 조건(앞 받침 ㅁ·ㅇ·ㄱ·ㅂ 등) 아님';
      }
    }
    return null;
  },
  '유음화': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    const d = diffIdx(A, B); if (!d.length) return '바뀐 곳 없음';
    for (const i of d) {
      const a = A[i], b = B[i]; if (!a || !b) return '한글 아님';
      if (a[1] !== b[1]) return '중성이 바뀜';
      if (a[2] !== b[2]) { if (!(a[2] === 'ㄴ' && b[2] === 'ㄹ')) return `받침 ${a[2]}→${b[2]}은 유음화가 아님`; const nx = B[i + 1]; if (!nx || nx[0] !== 'ㄹ') return '뒤에 ㄹ이 없음'; }
      if (a[0] !== b[0]) { if (!(a[0] === 'ㄴ' && b[0] === 'ㄹ')) return `초성 ${a[0]}→${b[0]}은 유음화가 아님`; const pv = B[i - 1]; if (!pv || pv[2] !== 'ㄹ') return '앞에 받침 ㄹ이 없음'; }
    }
    return null;
  },
  '구개음화': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    const d = diffIdx(A, B); if (!d.length) return '바뀐 곳 없음';
    let hit = false;
    for (const i of d) {
      const a = A[i], b = B[i]; if (!a || !b) return '한글 아님';
      if (a[1] !== b[1]) return '중성이 바뀜';
      if (a[0] !== b[0]) { // 초성이 ㅈ/ㅊ으로 (ㅇ→ㅈ/ㅊ 연음 겸, 또는 ㅌ→ㅊ)
        if ('ㅈㅊ'.indexOf(b[0]) < 0 || YJUNG.indexOf(a[1]) < 0) return `초성 ${a[0]}→${b[0]}(모음 ${a[1]})은 구개음화가 아님`;
        if (a[0] === 'ㅇ') { const pv = A[i - 1]; const pj = pv && pv[2]; const src = CLUSTER[pj] ? CLUSTER[pj][1] : pj; if (!(src === 'ㄷ' || src === 'ㅌ')) return '앞 받침이 ㄷ·ㅌ이 아님'; }
        else if (!(a[0] === 'ㄷ' || a[0] === 'ㅌ')) return `초성 ${a[0]}→${b[0]}은 구개음화가 아님`;
        hit = true;
      }
      if (a[2] !== b[2]) { // 받침 ㄷ/ㅌ이 뒤로 옮겨 감
        const src = CLUSTER[a[2]] ? CLUSTER[a[2]][1] : a[2]; const rest = CLUSTER[a[2]] ? CLUSTER[a[2]][0] : '';
        if (!((src === 'ㄷ' || src === 'ㅌ') && b[2] === rest)) return `받침 ${a[2]}→${b[2] || '∅'}은 구개음화가 아님`;
      }
    }
    return hit ? null : 'ㅈ·ㅊ이 생기지 않음';
  },
  '된소리되기': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    const d = diffIdx(A, B); if (!d.length) return '바뀐 곳 없음';
    for (const i of d) { const a = A[i], b = B[i]; if (!a || !b) return '한글 아님'; if (a[1] !== b[1] || a[2] !== b[2]) return '초성 외가 바뀜'; if (TENSE[a[0]] !== b[0]) return `초성 ${a[0]}→${b[0]}은 된소리되기가 아님`; }
    return null;
  },
  '사잇소리 현상': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    const d = diffIdx(A, B); if (!d.length) return '바뀐 곳 없음';
    for (const i of d) { const a = A[i], b = B[i]; if (!a || !b) return '한글 아님'; if (a[1] !== b[1]) return '중성이 바뀜'; if (a[0] !== b[0] && !(TENSE[a[0]] === b[0] || (a[0] === 'ㅇ' && b[0] === 'ㄴ'))) return `초성 ${a[0]}→${b[0]}`; if (a[2] !== b[2] && b[2] !== 'ㄴ' && !(a[2] === 'ㅅ' && (b[2] === '' || b[2] === 'ㄷ'))) return `받침 ${a[2] || '∅'}→${b[2] || '∅'}`; }
    return null;
  },
  '거센소리되기': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    if (jamoCount(A) - jamoCount(B) !== 1) return '음운이 하나 줄지 않음(' + jamoCount(A) + '→' + jamoCount(B) + ')';
    const d = diffIdx(A, B); if (d.length !== 2 || d[1] !== d[0] + 1) return '이웃한 두 음절이 바뀌어야 함';
    const [i, j] = d; const a = A[i], b = B[i], c = A[j], e = B[j]; if (!a || !b || !c || !e) return '한글 아님';
    if (a[0] !== b[0] || a[1] !== b[1] || c[1] !== e[1] || c[2] !== e[2]) return '초성·중성·뒤 받침이 바뀜';
    const aj = a[2], parts = CLUSTER[aj] ? CLUSTER[aj] : [aj], rest = CLUSTER[aj] ? parts[0] : '', last = CLUSTER[aj] ? parts[1] : aj;
    if (b[2] !== rest) return `받침 ${aj}→${b[2] || '∅'}`;
    if (last === 'ㅎ') { if (ASP[c[0]] !== e[0]) return `ㅎ 뒤 초성 ${c[0]}→${e[0]}`; }
    else if (c[0] === 'ㅎ') { if (ASP[last] !== e[0]) return `받침 ${last}+ㅎ→${e[0]}`; }
    else return 'ㅎ이 없음';
    return null;
  },
  '자음군 단순화': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    const d = diffIdx(A, B); if (!d.length) return '바뀐 곳 없음';
    for (const i of d) {
      const a = A[i], b = B[i]; if (!a || !b) return '한글 아님';
      if (a[0] !== b[0] || a[1] !== b[1]) return '초성·중성이 바뀜';
      if (!SIMPLIFY[a[2]]) return `받침 ${a[2] || '∅'}은 겹받침이 아님`;
      if (SIMPLIFY[a[2]].indexOf(b[2]) < 0) return `겹받침 ${a[2]}→${b[2] || '∅'}은 단순화 결과가 아님`;
    }
    return null;
  },
  'ㅎ 탈락': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    const d = diffIdx(A, B); if (!d.length) return '바뀐 곳 없음';
    for (const i of d) {
      const a = A[i], b = B[i]; if (!a || !b) return '한글 아님';
      if (a[0] !== b[0] || a[1] !== b[1]) return '초성·중성이 바뀜';
      const m = { 'ㅎ': '', 'ㄶ': 'ㄴ', 'ㅀ': 'ㄹ' }; if (m[a[2]] === undefined || m[a[2]] !== b[2]) return `받침 ${a[2] || '∅'}→${b[2] || '∅'}은 ㅎ 탈락이 아님`;
    }
    return null;
  },
  'ㄹ 탈락': (A, B) => {
    if (A.length === B.length) { const d = diffIdx(A, B); if (d.length !== 1) return '한 음절만 바뀌어야 함'; const a = A[d[0]], b = B[d[0]]; if (!a || !b || a[0] !== b[0] || a[1] !== b[1] || a[2] !== 'ㄹ' || b[2] !== '') return '받침 ㄹ이 빠진 것이 아님'; return null; }
    return null; // 활용형(놀-+-ㄴ→논)처럼 음절이 줄면 형태만 본다
  },
  'ㄴ 첨가': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    const d = diffIdx(A, B); if (!d.length) return '바뀐 곳 없음';
    for (const i of d) {
      const a = A[i], b = B[i]; if (!a || !b) return '한글 아님';
      if (!(a[0] === 'ㅇ' && b[0] === 'ㄴ') || a[1] !== b[1] || a[2] !== b[2]) return 'ㅇ→ㄴ 초성 첨가가 아님';
      if (YJUNG.indexOf(a[1]) < 0) return `모음 ${a[1]}은 ㄴ 첨가 환경(이·야·여·요·유)이 아님`;
      const pv = A[i - 1]; if (!pv || !pv[2]) return '앞 음절에 받침이 없음';
    }
    return null;
  },
  '반모음 첨가': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    const d = diffIdx(A, B); if (d.length !== 1) return '한 음절만 바뀌어야 함';
    const a = A[d[0]], b = B[d[0]]; const m = { 'ㅓ': 'ㅕ', 'ㅏ': 'ㅑ', 'ㅐ': 'ㅒ', 'ㅔ': 'ㅖ', 'ㅗ': 'ㅛ', 'ㅜ': 'ㅠ' };
    if (!a || !b || a[0] !== b[0] || a[2] !== b[2] || m[a[1]] !== b[1]) return '반모음이 덧난 형태가 아님';
    return null;
  },
  '모음 축약': (A, B) => (A.length !== B.length + 1) ? '음절 수가 하나 줄어야 함' : null,
  '모음 탈락': (A, B) => (A.length !== B.length + 1) ? '음절 수가 하나 줄어야 함' : null,
  '연음': (A, B) => {
    if (A.length !== B.length) return '음절 수 변함';
    const d = diffIdx(A, B); if (d.length !== 2 || d[1] !== d[0] + 1) return '이웃한 두 음절(받침→다음 초성)이 바뀌어야 함';
    const [i, j] = d; const a = A[i], b = B[i], c = A[j], e = B[j]; if (!a || !b || !c || !e) return '한글 아님';
    if (a[0] !== b[0] || a[1] !== b[1] || c[1] !== e[1] || c[2] !== e[2] || c[0] !== 'ㅇ') return '받침이 뒤 초성(ㅇ 자리)으로 옮겨 간 것이 아님';
    const parts = CLUSTER[a[2]] ? CLUSTER[a[2]] : [a[2]];
    if (parts.length === 1) { if (b[2] !== '' || e[0] !== parts[0]) return `받침 ${a[2]}이 그대로 옮겨 가지 않음`; }
    else if (!(b[2] === parts[0] && e[0] === parts[1])) return `겹받침 ${a[2]}의 뒤 자음만 옮겨 가야 함`;
    return null;
  }
};

// B에서 연음을 되돌린 후보들(뒤 초성을 앞 받침으로) — '규칙 + 연음'을 한 단계로 적은 문항용
function unYeonEum(B) {
  const out = [];
  for (let i = 0; i + 1 < B.length; i++) {
    const a = B[i], c = B[i + 1]; if (!a || !c || c[0] === 'ㅇ') continue;
    let jong = null;
    if (!a[2]) jong = c[0];
    else for (const k in CLUSTER) if (CLUSTER[k][0] === a[2] && CLUSTER[k][1] === c[0]) jong = k;
    if (jong === null || JONG.indexOf(jong) < 0) continue;
    const X = B.map(s => s && s.slice()); X[i][2] = jong; X[i + 1][0] = 'ㅇ'; out.push(X);
  }
  return out;
}
function passes(rule, A, B) {
  const fn = CHECK[rule]; if (!fn) return `모르는 규칙 '${rule}'`;
  const r = fn(A, B); if (r === null) return null;
  // 2026-09-13 사용자 결정: 연음은 별도 단계 — 규칙 결과에 연음을 녹인 단계는 통과시키지 않는다(unYeonEum은 분리 도구용으로 남김)
  return r;
}

// 사용자 결정 대기 — 검사에서는 '보류'로만 표시(종료 코드에 넣지 않음). 결정되면 데이터를 고치고 여기서 지운다.
const KNOWN = { /* '파일:번호': '이유' — 지금은 비어 있음 */ };
// 사용자가 '그대로 둔다'고 결정한 문항(2026-09-13) — 한 단계에 두 규칙이 들어 있지만 손대지 않는다. 검사에서는 '유지'로 표시.
const KEEP = {
  'pho-5:95': '밤낮없이: 연음 두 번 + 된소리되기를 한 단계에',
  'pho-5:96': '받히었다: 거센소리되기 + 끝소리 규칙(ㅆ→ㄷ)을 한 단계에',
  'pho-6:119': '값있다: 자음군 단순화 + 연음 + 끝소리 규칙을 한 단계에',
  'pho-6:124': '뚫네: ㅎ 탈락 + 유음화를 유음화 한 단계에',
  'pho-10:201': '맞혀: 거센소리되기와 ㅕ→ㅓ(표준 발음법 5항 다만1)를 한 단계에',
  'pho-17:341': '낳습니다: ㅎ+ㅅ→[ㅆ] — 교체+탈락/축약 논쟁(교재 485)',
  'pho-19:379': '닦달하다: 3단계 초성 ㅎ 탈락[닥딸아다]은 표준 발음([닥딸하다])이 아니나 사용자 결정으로 유지'
};

const ALLOW = new Set([ /* '파일:번호:단계' — 사용자 결정으로 허용한 예외를 적는다 */ ]);

let files = 0, qs = 0, bad = 0, checked = 0; const held = [], kept = [];
const starts = new Map();
const pat = { tenseThenCluster: [], clusterThenTense: [], nAddBeforeFinal: [], finalBeforeNAdd: [], yeonEum: 0, folded: [] };
function warn(f, q, msg) { bad++; console.log(`  ✗ ${f} ${q.num}번 ${q.start}: ${msg}`); }

for (const f of fs.readdirSync(DIR).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
  if (!/^pho-\d+\.json$/.test(f)) continue;
  files++;
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const q of d.questions) {
    if (q.type !== 'process') continue;
    qs++;
    const key = normStart(q.start);
    if (!starts.has(key)) starts.set(key, []); starts.get(key).push(`${f.replace('.json', '')}#${q.num}`);
    let prev = normStart(q.start);
    const rules = q.steps.map(s => s.accept[0]);
    q.steps.forEach((s, si) => {
      const alts = ('' + s.form).split('/');
      const prevAlts = ('' + prev).split('/');
      let ok = false, why = [];
      for (const r of s.accept) {
        for (const pa of prevAlts) for (const fa of alts) { const res = passes(r, dec(pa), dec(fa)); if (res === null) ok = true; else why.push(`${r}: ${res}`); }
      }
      checked++;
      const kk = `${f.replace('.json', '')}:${q.num}`;
      if (!ok && !ALLOW.has(`${f}:${q.num}:${si + 1}`)) {
        if (KNOWN[kk]) { held.push(`${kk} ${q.start} — ${KNOWN[kk]}`); }
        else if (KEEP[kk]) { kept.push(`${kk} ${q.start} — ${KEEP[kk]}`); }
        else warn(f, q, `${si + 1}단계 [${s.accept.join('/')}] ${prev}→${s.form} — ${[...new Set(why)].join(' / ')}`);
      }
      prev = s.form;
    });
    // 최종 발음 검사
    for (const fa of ('' + prev).split('/')) {
      const bad7 = dec(fa).filter(s => s && FINAL_OK.indexOf(s[2]) < 0).map(s => s[2]);
      if (bad7.length) warn(f, q, `최종 발음 '${fa}'의 받침 ${bad7.join(',')}은 대표음이 아님`);
    }
    // 겹받침+된소리 순서(2026-09-13 사용자 결정): 자음군 단순화로 '조건이 되는 자음'(ㄾ의 ㅌ, ㄼ의 ㅂ, ㄱ 앞 ㄺ의 ㄱ)이
    // 떨어져 나가는 단어는 된소리되기가 먼저여야 한다. 남는 자음(ㄱ·ㅂ, 어간 ㄴ·ㅁ)이 조건이면 순서 무관.
    let cur = normStart(q.start);
    for (let i = 0; i + 1 < rules.length; i++) {
      const tag = `${f.replace('.json', '')}#${q.num} ${q.start}`;
      if (rules[i] === '된소리되기' && rules[i + 1] === '자음군 단순화') pat.tenseThenCluster.push(tag);
      if (rules[i] === '자음군 단순화' && rules[i + 1] === '된소리되기') {
        pat.clusterThenTense.push(tag);
        const A = dec(cur), B = dec('' + q.steps[i].form);
        const k = diffIdx(A, B)[0]; const a = A[k], b = B[k];
        if (a && b && ((a[2] === 'ㄾ' && b[2] === 'ㄹ') || (a[2] === 'ㄼ' && b[2] === 'ㄹ') || (a[2] === 'ㄺ' && b[2] === 'ㄹ')))
          warn(f, q, `자음군 단순화(${a[2]}→ㄹ)로 된소리되기 조건이 사라짐 — 된소리되기를 먼저 둘 것`);
      }
      cur = '' + q.steps[i].form;
    }
    // ㄴ 첨가 ↔ 끝소리 규칙 순서(2026-09-13 사용자 결정): 끝소리 규칙이 앞말 끝(ㄴ이 붙는 음절 바로 앞)에 걸리면 ㄴ 첨가보다 먼저,
    // 뒷말 끝(ㄴ이 붙는 음절 이후)에 걸리면 ㄴ 첨가 뒤. 한 단계가 두 자리를 다 바꾸면 '사용자 결정 대기'.
    const iN = rules.indexOf('ㄴ 첨가'), iF = rules.indexOf('음절의 끝소리 규칙');
    if (iN >= 0 && iF >= 0) {
      (iN < iF ? pat.nAddBeforeFinal : pat.finalBeforeNAdd).push(`${f.replace('.json', '')}#${q.num} ${q.start}`);
      const formAt = k => k < 0 ? normStart(q.start) : '' + q.steps[k].form;
      const nIdx = diffIdx(dec(formAt(iN - 1)), dec(formAt(iN)))[0];
      q.steps.forEach((st, k) => {
        if (st.accept[0] !== '음절의 끝소리 규칙') return;
        const ch = diffIdx(dec(formAt(k - 1)), dec(formAt(k)));
        const before = ch.some(i => i === nIdx - 1), after = ch.some(i => i >= nIdx);
        const kk = `${f.replace('.json', '')}:${q.num}`;
        if (before && after) { if (KNOWN[kk]) held.push(`${kk} ${q.start} — ${KNOWN[kk]}`); else warn(f, q, `끝소리 규칙이 앞말 끝과 뒷말 끝을 한 단계에 — 어느 쪽을 먼저 둘지 결정 필요`); }
        else if (before && k > iN) warn(f, q, `앞말 끝의 끝소리 규칙은 ㄴ 첨가보다 먼저 둘 것`);
        else if (after && k < iN) warn(f, q, `뒷말 끝의 끝소리 규칙은 ㄴ 첨가 뒤에 둘 것`);
      });
    }
    if (rules.indexOf('연음') >= 0) pat.yeonEum++;
  }
}
const dups = [...starts.entries()].filter(([, v]) => v.length > 1);
console.log(`\n[순서 유형] 된소리되기→자음군 단순화 ${pat.tenseThenCluster.length}건: ${pat.tenseThenCluster.join(', ') || '없음'}`);
console.log(`                자음군 단순화→된소리되기 ${pat.clusterThenTense.length}건: ${pat.clusterThenTense.join(', ') || '없음'}`);
console.log(`                ㄴ 첨가→끝소리 규칙 ${pat.nAddBeforeFinal.length}건: ${pat.nAddBeforeFinal.join(', ') || '없음'}`);
console.log(`                끝소리 규칙→ㄴ 첨가 ${pat.finalBeforeNAdd.length}건: ${pat.finalBeforeNAdd.join(', ') || '없음'}`);
console.log(`                연음을 단계로 둔 문항 ${pat.yeonEum}건`);
console.log(`[사용자 결정 대기] ${held.length}건`); [...new Set(held)].forEach(h => console.log('  · ' + h));
console.log(`[그대로 두기로 한 문항] ${new Set(kept).size}건`); [...new Set(kept)].forEach(h => console.log('  · ' + h));
console.log(`[start 중복] ${dups.length}건${dups.length ? ':' : ''}`); dups.forEach(([k, v]) => console.log(`  ${k}: ${v.join(', ')}`));
console.log(bad ? `\n불일치 ${bad}건 (파일 ${files} · 문항 ${qs} · 단계 ${checked})` : `\n전체 통과 — 파일 ${files}개 · 문항 ${qs}개 · 단계 ${checked}개`);
process.exit(bad ? 1 : 0);
