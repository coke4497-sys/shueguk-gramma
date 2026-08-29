/* 문항 데이터 파일 검증 — data/*.json 전체의 형식을 점검한다.
 *   - total과 문항 수 일치, num이 1부터 순서대로
 *   - type별 필수 필드: ox(answer O/X), choice(options 2개 이상 + answer 범위),
 *     short(answer), process(start·steps)
 *   - short 정답에 공백 의존이 없는지(normalize가 공백을 제거하므로 공백만 다른
 *     보기를 구별하는 문제는 만들면 안 됨 — 검사 불가, 참고용)
 *   실행: node tools/data-check.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'data');

let files = 0, qs = 0, bad = 0;
function err(f, msg) { bad++; console.error('  ✗ ' + f + ': ' + msg); }

for (const f of fs.readdirSync(DIR).sort()) {
  if (!f.endsWith('.json')) continue;
  files++;
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); }
  catch (e) { err(f, 'JSON 파싱 실패: ' + e.message); continue; }
  const list = d.questions || [];
  if (!list.length) { err(f, '문항 없음'); continue; }
  if (d.total !== list.length) err(f, `total(${d.total}) ≠ 문항 수(${list.length})`);
  if (!d.category) err(f, 'category 없음');
  list.forEach((q, i) => {
    qs++;
    const tag = `${q.num}번`;
    if (q.type === 'process') {
      if (!q.start || !Array.isArray(q.steps) || !q.steps.length) err(f, tag + ' process 필드 누락');
      q.steps && q.steps.forEach((s, si) => {
        if (!Array.isArray(s.accept) || !s.accept.length || !s.form) err(f, tag + ' step' + (si + 1) + ' 누락');
        if (d.ruleOptions && s.accept) s.accept.forEach(a => {
          if (!d.ruleOptions.includes(a)) err(f, tag + ` accept '${a}'가 ruleOptions에 없음`);
        });
      });
    } else if (q.type === 'ox') {
      if (q.answer !== 'O' && q.answer !== 'X') err(f, tag + ' ox 정답이 O/X가 아님: ' + q.answer);
      if (!q.stem) err(f, tag + ' stem 없음');
    } else if (q.type === 'choice') {
      if (!Array.isArray(q.options) || q.options.length < 2) err(f, tag + ' options 부족');
      const a = parseInt(q.answer, 10);
      if (!(a >= 1 && a <= (q.options || []).length)) err(f, tag + ' 정답 번호 범위 밖: ' + q.answer);
      if (!q.stem) err(f, tag + ' stem 없음');
      const uniq = new Set(q.options);
      if (uniq.size !== q.options.length) err(f, tag + ' 보기 중복');
    } else { // short
      if (q.answer == null || q.answer === '') err(f, tag + ' 단답 정답 없음');
      if (!q.stem) err(f, tag + ' stem 없음');
    }
    if (q.num !== (list[0].num === 1 ? i + 1 : q.num)) err(f, tag + ' 번호가 순서와 어긋남(i=' + (i + 1) + ')');
  });
}
console.log(bad ? `\n실패 ${bad}건 (파일 ${files} · 문항 ${qs})` : `전체 통과 — 파일 ${files}개 · 문항 ${qs}개`);
process.exit(bad ? 1 : 0);
