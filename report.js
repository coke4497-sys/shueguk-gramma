/* 문법 테스트 오류 제보 — 플레이(play.html)·전체 제출(test.html) 공용 (2026-09-18 사용자 "수정 요청함처럼 문법 테스트 오류 제보 메뉴").
 * 제보는 리포트 백엔드의 수정 요청함('수정요청' 탭, 화면 '문법 테스트')으로 들어가고, 등록 즉시 클로드 세션이 읽어
 * 확인 결과를 원장님께 알린다(데이터 수정은 원장님과 결정 — 리포트 CLAUDE.md '시간표 수정 요청함' 절).
 * 쓰는 법: 페이지가 GRAMMA_REPORT.info = function(key){ return {cat, level, round, qno, start, mine, answer, preview, who:{name,school,grade}}; }
 *          를 두고, 화면에 <button class="rp-link" data-rp="key">이 문항 오류 제보</button>를 놓으면 된다. 8자리 번호는 보내지 않는다. */
(function() {
    var REPORT_URL = 'https://script.google.com/macros/s/AKfycbzhCncBwn-JlqXARC3wfrWUCuNHzlNK2df0bdhx-w78Xr8mzYUcIYZOJdRi9N4bHtsb/exec';
    var KINDS = ['정답이 틀린 것 같아요', '문항·해설 오타', '화면이 이상해요', '기타'];
    var sent = {};   // 이 판에서 보낸 문항 키 — 같은 문항 재전송 잠금
    var CSS = '.rp-link{background:none;border:none;font:inherit;font-size:13px;color:#8D83A8;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:4px 2px;align-self:flex-start;}' +
        '.rp-link:disabled{color:#9BA8A1;text-decoration:none;cursor:default;}' +
        '#rpModal{position:fixed;inset:0;background:rgba(42,51,47,.45);display:flex;align-items:flex-end;justify-content:center;z-index:50;padding:0;}' +
        '@media(min-width:560px){#rpModal{align-items:center;padding:20px;}}' +
        '#rpModal.hidden{display:none;}' +
        '.rp-box{background:#fff;border-radius:22px 22px 0 0;width:100%;max-width:520px;padding:20px 18px calc(20px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:10px;max-height:92vh;overflow:auto;font-family:"Gowun Dodum",sans-serif;color:#2A332F;}' +
        '@media(min-width:560px){.rp-box{border-radius:20px;}}' +
        '.rp-title{font-family:"Gowun Batang",serif;font-size:18px;font-weight:700;}' +
        '.rp-where{background:#F4F5F3;border-radius:12px;padding:10px 12px;font-size:13px;line-height:1.55;color:#4F5C56;}' +
        '.rp-where b{color:#2A332F;}' +
        '.rp-lb{font-size:12.5px;font-weight:700;color:#5C6A64;margin-top:2px;}' +
        '.rp-kinds{display:flex;flex-wrap:wrap;gap:6px;}' +
        '.rp-kind{font:inherit;font-size:13px;border:none;border-radius:999px;padding:7px 12px;background:#F4F5F3;color:#4F5C56;cursor:pointer;}' +
        '.rp-kind.on{background:#6B5B7B;color:#fff;}' +
        '.rp-text{width:100%;min-height:96px;font:inherit;font-size:15px;border:1.5px solid #E5EDE8;border-radius:12px;padding:10px 12px;resize:vertical;}' +
        '.rp-text:focus{outline:none;border-color:#D6C9E4;}' +
        '.rp-msg{font-size:13px;color:#A8402E;min-height:1.2em;}' +
        '.rp-msg.ok{color:#276B4E;}' +
        '.rp-btns{display:flex;gap:8px;}' +
        '.rp-btn{flex:1;font:inherit;font-size:16px;font-weight:700;border:none;border-radius:14px;padding:14px;min-height:50px;cursor:pointer;}' +
        '.rp-btn.send{background:#EDE4F4;color:#5A4A6A;}' +
        '.rp-btn.send:disabled{background:#F2EEF5;color:#B0A7BC;cursor:default;}' +
        '.rp-btn.cancel{background:#F4F5F3;color:#4F5C56;}' +
        '.rp-done{font-size:14px;line-height:1.6;color:#2A332F;background:#EAF3ED;border-radius:12px;padding:12px 14px;}';
    var cur = null, curKey = '';
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function style() { if (document.getElementById('rpStyle')) return; var st = document.createElement('style'); st.id = 'rpStyle'; st.textContent = CSS; document.head.appendChild(st); }
    if (document.head) style(); else document.addEventListener('DOMContentLoaded', style);
    function ensure() {
        if (document.getElementById('rpModal')) return;
        style();
        var m = document.createElement('div'); m.id = 'rpModal'; m.className = 'hidden';
        m.innerHTML = '<div class="rp-box" role="dialog" aria-label="문항 오류 제보">' +
            '<div class="rp-title">문항 오류 제보</div>' +
            '<div class="rp-where" id="rp-where"></div>' +
            '<div id="rp-form">' +
            '<div class="rp-lb">어떤 문제인가요?</div><div class="rp-kinds" id="rp-kinds">' + KINDS.map(function(k, i) { return '<button type="button" class="rp-kind' + (i === 0 ? ' on' : '') + '" data-k="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>' +
            '<div class="rp-lb" style="margin-top:8px;">어떤 점이 이상한지 적어 주세요</div>' +
            '<textarea class="rp-text" id="rp-text" maxlength="500" placeholder="예: 정답이 ○○여야 할 것 같아요 / 해설에 오타가 있어요"></textarea>' +
            '<div class="rp-msg" id="rp-msg"></div>' +
            '<div class="rp-btns"><button type="button" class="rp-btn cancel" id="rp-cancel">닫기</button><button type="button" class="rp-btn send" id="rp-send">보내기</button></div>' +
            '</div>' +
            '<div id="rp-done" class="hidden"><div class="rp-done">고마워요! 선생님께 전달됐어요.<br>확인 뒤 필요하면 문항을 고칠게요.</div><div class="rp-btns" style="margin-top:10px;"><button type="button" class="rp-btn cancel" id="rp-close">닫기</button></div></div>' +
            '</div>';
        document.body.appendChild(m);
        m.addEventListener('click', function(ev) { if (ev.target === m) close(); });
        document.getElementById('rp-cancel').addEventListener('click', close);
        document.getElementById('rp-close').addEventListener('click', close);
        document.getElementById('rp-kinds').addEventListener('click', function(ev) {
            var b = ev.target.closest('.rp-kind'); if (!b) return;
            m.querySelectorAll('.rp-kind').forEach(function(x) { x.classList.toggle('on', x === b); });
        });
        document.getElementById('rp-send').addEventListener('click', send);
    }
    function whereText(info) {
        var parts = [info.cat + (info.level ? ' ' + info.level : ''), '스테이지 ' + info.round, info.qno + '번'];
        return '<b>' + esc(parts.join(' · ')) + '</b>' + (info.start ? '<br>' + esc(String(info.start).length > 80 ? String(info.start).slice(0, 80) + '…' : info.start) : '') +
            (info.mine != null || info.answer != null ? '<br><span style="color:#6A716C;">내 답 ' + esc(info.mine || '-') + ' → 정답 ' + esc(info.answer || '-') + '</span>' : '');
    }
    function open(key) {
        var fn = window.GRAMMA_REPORT && GRAMMA_REPORT.info;
        var info = fn ? fn(key) : null;
        if (!info) return;
        ensure(); cur = info; curKey = key;
        document.getElementById('rp-where').innerHTML = whereText(info);
        document.getElementById('rp-text').value = '';
        document.getElementById('rp-msg').textContent = ''; document.getElementById('rp-msg').className = 'rp-msg';
        var m = document.getElementById('rpModal');
        m.querySelectorAll('.rp-kind').forEach(function(x, i) { x.classList.toggle('on', i === 0); });
        document.getElementById('rp-form').classList.toggle('hidden', !!sent[key]);
        document.getElementById('rp-done').classList.toggle('hidden', !sent[key]);
        document.getElementById('rp-send').disabled = false; document.getElementById('rp-send').textContent = '보내기';
        m.classList.remove('hidden');
        if (!sent[key] && matchMedia('(hover: hover)').matches) document.getElementById('rp-text').focus();
    }
    function close() { var m = document.getElementById('rpModal'); if (m) m.classList.add('hidden'); }
    function send() {
        var text = (document.getElementById('rp-text').value || '').trim(), msg = document.getElementById('rp-msg'), btn = document.getElementById('rp-send');
        if (!text) { msg.textContent = '어떤 점이 이상한지 적어 주세요.'; msg.className = 'rp-msg'; return; }
        var kindEl = document.querySelector('#rp-kinds .rp-kind.on');
        var who = cur.who || {};
        var payload = { action: 'grammaReport', name: who.name || '', school: who.school || '', grade: who.grade || '', cat: cur.cat || '', level: cur.level || '', round: cur.round || '', qno: cur.qno || '', start: cur.start || '', kind: kindEl ? kindEl.getAttribute('data-k') : '', text: text, mine: cur.mine || '', answer: cur.answer || '', preview: !!cur.preview };
        btn.disabled = true; btn.textContent = '보내는 중…'; msg.textContent = ''; msg.className = 'rp-msg';
        fetch(REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
            .then(function(r) { return r.json(); })
            .then(function(j) {
                if (!j || j.result !== 'success') throw new Error((j && j.message) || 'fail');
                sent[curKey] = true;
                document.getElementById('rp-form').classList.add('hidden'); document.getElementById('rp-done').classList.remove('hidden');
                document.querySelectorAll('.rp-link[data-rp="' + curKey + '"]').forEach(function(b) { b.disabled = true; b.textContent = '제보 완료'; });
            })
            .catch(function(e) {
                msg.textContent = (e && e.message && e.message !== 'fail' && !/json|fetch|network/i.test(e.message)) ? e.message : '지금은 보낼 수 없어요. 잠시 뒤 다시 눌러 주세요.';
                btn.disabled = false; btn.textContent = '보내기';
            });
    }
    document.addEventListener('click', function(ev) {
        var b = ev.target.closest('.rp-link'); if (!b || b.disabled) return;
        open(b.getAttribute('data-rp'));
    });
    function sync() { document.querySelectorAll('.rp-link[data-rp]').forEach(function(b) { if (sent[b.getAttribute('data-rp')]) { b.disabled = true; b.textContent = '제보 완료'; } }); }
    window.GRAMMA_REPORT = window.GRAMMA_REPORT || {};
    GRAMMA_REPORT.open = open; GRAMMA_REPORT.sync = sync; GRAMMA_REPORT.close = close; GRAMMA_REPORT.KINDS = KINDS; GRAMMA_REPORT.REPORT_URL = REPORT_URL;
    GRAMMA_REPORT.linkHTML = function(key, label) { return '<button type="button" class="rp-link" data-rp="' + esc(key) + '">' + esc(label || '이 문항 오류 제보') + '</button>'; };
})();
