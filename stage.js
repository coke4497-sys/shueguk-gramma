/* ===== 문법 스테이지 게임 — 공통 규칙 (index.html · play.html · test.html · top30.html이 함께 읽는다) =====
   사용자 결정(2026-09-15~16): 스테이지 = 회차, 정답률 70% 이상이면 통과(다음 스테이지 열림),
   스테이지 5개 = 세트 하나, 세트 안 스테이지를 모두 통과하면 세트 클리어 → 슈퍼스타 별 +1
   (회차마다 90% 이상 → 별 +1 규칙은 폐지). 서버 쪽 판정은 리포트 저장소 supabase/migrations/029_gramma_stages.sql —
   세트 구성(어느 회차가 몇 번 세트인지)은 여기(manifest 기준)가 정해 요청에 실어 보낸다. 값을 바꾸면 029의 gramma_pass_pct()도 함께. */
(function() {
  var SET_SIZE = 5, PASS_PCT = 70;
  function tests() { return (window.GRAMMA && window.GRAMMA.tests) || {}; }
  function roundsOf(code) {
    var out = [], T = tests();
    Object.keys(T).forEach(function(k) { var m = k.match(/^(.+)-(\d+)$/); if (m && m[1] === code) out.push(parseInt(m[2], 10)); });
    return out.sort(function(a, b) { return a - b; });
  }
  // 세트 목록 [{no, rounds:[6,7,8,9,10]}] — 회차 순서대로 5개씩(마지막 세트는 남는 만큼)
  function setsOf(code) {
    var rs = roundsOf(code), out = [];
    for (var i = 0; i < rs.length; i += SET_SIZE) out.push({ no: out.length + 1, rounds: rs.slice(i, i + SET_SIZE) });
    return out;
  }
  function setOf(code, round) {
    var r = parseInt(round, 10), sets = setsOf(code);
    for (var i = 0; i < sets.length; i++) if (sets[i].rounds.indexOf(r) >= 0) return sets[i];
    return null;
  }
  /* 진행 상태 — status: gramma_status 응답({items:[{unit,round,best,pass}], sets:[{unit,set_no}], stars})
     label: 카테고리 라벨('한글 맞춤법'). 결과: {best:{round:pct}, pass:{round:true}, cleared:{setNo:true},
     open:{round:true} — 첫 스테이지는 항상 열림, 그 다음은 앞 스테이지를 통과해야(순서대로) 열림} */
  function progress(code, label, status) {
    var best = {}, pass = {}, cleared = {}, open = {};
    ((status && status.items) || []).forEach(function(it) {
      if (it.unit !== label) return;
      var r = parseInt(it.round, 10), b = Number(it.best) || 0;
      if (!(r in best) || b > best[r]) best[r] = b;
      if (b >= PASS_PCT) pass[r] = true;
    });
    ((status && status.sets) || []).forEach(function(s) { if (s.unit === label) cleared[s.set_no] = true; });
    var rs = roundsOf(code), prevOK = true;
    rs.forEach(function(r) { open[r] = prevOK; prevOK = prevOK && !!pass[r]; });
    // 세트를 클리어한 기록이 있으면 그 세트의 스테이지는 모두 통과로 본다(회차가 나중에 바뀌어도 잠기지 않게)
    setsOf(code).forEach(function(s) { if (cleared[s.no]) s.rounds.forEach(function(r) { pass[r] = true; open[r] = true; }); });
    rs.forEach(function(r, i) { if (i > 0 && pass[rs[i - 1]]) open[r] = true; });
    return { best: best, pass: pass, cleared: cleared, open: open };
  }
  // 다음 스테이지(같은 카테고리에서 이 회차 다음 회차, 없으면 null)
  function nextRound(code, round) {
    var rs = roundsOf(code), i = rs.indexOf(parseInt(round, 10));
    return (i >= 0 && i + 1 < rs.length) ? rs[i + 1] : null;
  }
  window.STAGE = { SET_SIZE: SET_SIZE, PASS_PCT: PASS_PCT, roundsOf: roundsOf, setsOf: setsOf, setOf: setOf, progress: progress, nextRound: nextRound };
})();
