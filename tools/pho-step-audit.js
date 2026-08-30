/* 음운(pho) 과정형 문항 점검 — 단계마다 실제로 일어난 변화와 고른 변동 종류가 맞는지 본다.
 * 한 단계에서 두 가지 변동이 함께 일어났거나(뭉뚱그림), 최종 발음에 겹받침·연음 자리가
 * 남아 있으면 알려 준다. 자동 판정이라 확정이 아니라 '살펴볼 후보' 목록이다.
 *   node tools/pho-step-audit.js
 * 남는 몇 건은 표기 방식 때문이다 — '안- + -다'처럼 형태소를 나눠 적은 문항,
 * '받히었다'·'맞혀'처럼 한 단계에 모음 변화가 함께 오는 문항. 오류가 아니다.
 */
const fs = require('fs');
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'.split('');
const JONG = ['', 'ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const DOUBLE = ['ㄳ','ㄵ','ㄶ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅄ'];
const SEVEN = ['', 'ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅇ'];
const TENSE = { 'ㄱ':'ㄲ', 'ㄷ':'ㄸ', 'ㅂ':'ㅃ', 'ㅅ':'ㅆ', 'ㅈ':'ㅉ' };
const ASPIR = { 'ㄱ':'ㅋ', 'ㄷ':'ㅌ', 'ㅂ':'ㅍ', 'ㅈ':'ㅊ' };

function split(s) {                       // 음절 → [초성, 중성, 종성]
  return [...s].map(ch => {
    const c = ch.charCodeAt(0) - 0xAC00;
    if (c < 0 || c > 11171) return [ch, '', ''];
    return [CHO[Math.floor(c / 588)], Math.floor(c % 588 / 28), JONG[c % 28]];
  });
}

// 한 단계(before → after)에서 일어난 변화의 종류를 뽑는다
function events(before, after) {
  const A = split(before), B = split(after), ev = new Set();
  if (A.length !== B.length) { ev.add('음절 수 변화'); return ev; }
  for (let i = 0; i < A.length; i++) {
    const [ac, av, aj] = A[i], [bc, bv, bj] = B[i];
    const next = A[i + 1], nextB = B[i + 1];
    if (aj !== bj) {
      if (aj && !bj && next && next[0] === 'ㅇ' && nextB && nextB[0] !== 'ㅇ') ev.add('연음');
      else if (DOUBLE.includes(aj) && !DOUBLE.includes(bj)) ev.add(bj === '' && /[ㄶㅀ]/.test(aj) ? 'ㅎ 탈락/자음군 단순화' : '자음군 단순화');
      else if (aj === 'ㅎ' && bj === '') ev.add('ㅎ 탈락');
      else if (!SEVEN.includes(aj) && SEVEN.includes(bj)) ev.add('음절의 끝소리 규칙');
      else ev.add('받침 바뀜(' + aj + '→' + (bj || '없음') + ')');
    }
    if (ac !== bc) {
      if (TENSE[ac] === bc) ev.add('된소리되기');
      else if (ASPIR[ac] === bc) ev.add('거센소리되기');
      else if (ac === 'ㅇ' && bc !== 'ㅇ') { if (!ev.has('연음')) ev.add('연음'); }
      else ev.add('첫소리 바뀜(' + ac + '→' + bc + ')');
    }
    if (av !== bv) ev.add('모음 바뀜');
  }
  return ev;
}

// 변동 이름 ↔ 검출한 변화가 같은 것으로 볼 수 있는지
// (한 변동 안에서 함께 일어나는 변화는 여기서 같은 것으로 친다 — 아래 주석 참고)
function same(rule, e) {
  if (e === rule) return true;
  // ㄴ 첨가는 뒤 음절 첫소리 ㅇ이 ㄴ으로 바뀌는 것이라 '연음'처럼 보인다
  if (rule === 'ㄴ 첨가' && e === '연음') return true;
  // 사잇소리 현상의 실제 모습이 된소리되기다
  if (rule === '사잇소리 현상' && e === '된소리되기') return true;
  // 거센소리되기는 ㅎ이 이웃 자음과 합쳐지는 것 — ㅎ이 사라지고 겹받침이 홑받침이 된다
  if (rule === '거센소리되기' && (e === 'ㅎ 탈락' || e === '자음군 단순화' || e === 'ㅎ 탈락/자음군 단순화')) return true;
  // 겹받침 뒤에 모음으로 시작하는 형식형태소가 오면 뒤엣것만 연음된다(표준발음법 제14항)
  if (rule === '연음' && (e === '자음군 단순화' || e === 'ㅎ 탈락/자음군 단순화')) return true;
  // 구개음화는 뒤 음절로 옮겨 적으므로 연음이 함께 보인다(이 저장소의 표기 관례)
  if (rule === '구개음화' && e === '연음') return true;
  // ㄶ·ㅀ 뒤 ㅅ은 ㅆ으로 발음한다(제12항 붙임)
  if (rule === '된소리되기' && (e === '자음군 단순화' || e === 'ㅎ 탈락/자음군 단순화' || e === 'ㅎ 탈락')) return true;
  if (e === 'ㅎ 탈락/자음군 단순화') return rule === 'ㅎ 탈락' || rule === '자음군 단순화';
  if (e.startsWith('첫소리 바뀜') || e.startsWith('받침 바뀜'))
    return ['비음화','유음화','구개음화','거센소리되기','음절의 끝소리 규칙','자음군 단순화','ㅎ 탈락','사잇소리 현상','ㄹ 탈락'].includes(rule);
  if (e === '음절 수 변화') return ['ㄴ 첨가','반모음 첨가','모음 탈락','ㄹ 탈락','사잇소리 현상'].includes(rule);
  if (e === '모음 바뀜') return ['반모음 첨가','모음 탈락'].includes(rule);
  return false;
}

const hits = [];
for (let r = 1; r <= 20; r++) {
  const d = JSON.parse(fs.readFileSync(__dirname + '/../data/pho-' + r + '.json'));
  d.questions.forEach(q => {
    if (q.type !== 'process') return;
    let cur = q.start;
    (q.steps || []).forEach((st, i) => {
      const ev = [...events(cur, st.form)];
      const note = [];
      // ① 고른 변동으로 설명되지 않는 변화가 함께 일어난 단계 (= 두 변동을 한 칸에 넣음)
      const unex = ev.filter(e => !st.accept.some(rule => same(rule, e)));
      if (unex.length) note.push('설명 안 되는 변화: ' + unex.join(', '));
      // ② 아무 변화도 없는 단계
      if (!ev.length && !st.accept.includes('변동 없음')) note.push('형태가 그대로');
      if (note.length) hits.push(`${r}회 ${q.num}번 ${q.start} · ${i + 1}단계 [${st.accept.join('/')}] ${cur}→${st.form} — ${note.join(' / ')}`);
      cur = st.form;
    });
    // ③ 최종 발음에 겹받침이나 연음할 자리가 남아 있는지
    const F = split(cur);
    const left = [];
    F.forEach(([c, v, j], i) => {
      if (DOUBLE.includes(j)) left.push('겹받침 ' + j);
      if (j && j !== 'ㅇ' && F[i + 1] && F[i + 1][0] === 'ㅇ') left.push('연음 안 된 자리 ' + j + '+ㅇ');
    });
    if (left.length) hits.push(`${r}회 ${q.num}번 ${q.start} · 최종 [${cur}] — ${left.join(', ')}`);
  });
}
console.log(hits.length ? hits.join('\n') + '\n\n살펴볼 문항 ' + hits.length + '건' : '이상 없음');
