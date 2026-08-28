# 작업 메모 (이수경국어 · 슈국 — 문법 테스트)

## 브랜드
- 폰트: 고운 돋움 + 나눔 명조 (어휘 테스트와 동일 톤), 색: 세이지 그린 계열
- UI에 컬러 이모지 아이콘을 쓰지 않는다 — 라인 SVG 또는 텍스트만 (사용자 확정 지침, 2026-08-14)

## 문법 테스트 — 어휘 방식으로 개편 (2026-08-28)
어휘 테스트(shueguk-voca)와 같은 구조로 바꿨다: `manifest.js`(카테고리·테스트 등록) +
`data/{코드}-{회차}.json`(문항) + 공용 `test.html`(?c=&r=). 여기에 어휘에는 없는
**배정 기능**(학년/학교/개인)을 얹었다.
- **카테고리 10개**(사용자 지정, 2026-08-28): 음운(pho) · 형태소(mor) · 품사(pos) ·
  단어 형성법(wfm) · 문장(sen) · 높임법(hon) · 사동과 피동(cap) · 시제와 부정 표현(ten) ·
  한글 맞춤법(ort) · 중세 국어(mid)
- **기존 음운 변동 1~10회는 data/pho-1~10.json으로 이전** — 원본 HTML의 QUIZ와 왕복 대조로
  검증(스크래치패드 extract-pho.js). 옛 `shueguk-phonology-N-student.html`은 옛 링크 호환용으로
  남겨 둠(새 링크 발송은 test.html 경유). 나머지 9개 카테고리는 자리만 있고 문항은 비어 있다 —
  **문항 콘텐츠는 임의로 만들지 말 것**(어휘 CLAUDE.md와 같은 지침), 사용자가 주는 자료로 등록.
- **문항 type**: `process`(음운 변동 과정 완성 — 단계마다 변동 종류 select + 형태 입력),
  `short`(단답)/`ox`/`choice`(어휘 test.html과 같은 채점 규칙). process 채점은 옛 페이지와 동일하되
  "기어서/기여서"처럼 빗금 표기 형태는 어느 쪽을 써도 정답으로 인정(formOK).
- **배정**: 결과 시트의 '배정' 탭(A:기록일시 B:대상구분(학년|학교|개인) C:대상 D:카테고리코드
  E:카테고리 F:회차 G:메모 H:상태(진행|마감)). 교사 액션(키 필요) assignList/assignAdd/assignSet/
  assignDel(assignSet·Del은 row+time 대조로 행 밀림 방지), 학생 공개 액션 myAssign&grade=&school=&name=.
  학교 대조는 한쪽이 다른 쪽으로 시작하면 인정("화정고"↔"화정고등학교"), 이름·학년은 공백 제거 후 일치.
- **제출 게이트**: test.html이 제출 시점에 myAssign으로 배정 여부를 확인해 아니면 막는다.
  확인 실패·옛 배포본(응답에 kind:'assign' 없음)이면 받아준다 — 어휘의 열린 주차 확인과 같은 방침.
  ?preview=1(티쳐스 미리보기)은 확인 생략.
- **결과 제출 payload는 옛 그대로**(time,name,school,grade,unit,round,score,details — unit=카테고리
  라벨) → 결과 수집(doPost)은 재배포 없이도 동작. 옛 데이터의 unit '음운 변동'과 새 '음운'은
  대시보드 단원 필터에서 서로 다른 값으로 보인다(정상).
- **배정 기능은 Apps Script 재배포가 필요하다** — 티쳐스 페이지는 응답에 kind:'assign'이 없으면
  "재배포 필요" 안내를 띄운다(옛 배포본은 assignList 요청에 결과 rows를 돌려주므로 kind로 구분).
  재배포 방법은 shuegukweekendtest CLAUDE.md의 clasp 절차(문법 스크립트 ID는 아직 표에 없음 —
  배포 주소의 AKfycbzikteq… 부분이 DEPLOYMENT_ID).
- 검증(2026-08-28): 브라우저 E2E(tools/e2e-test.js — 정적 서빙 + script.google.com 가로채기)로
  응시→채점→배정 차단/허용→제출 payload, index.html 배정 목록, 대시보드 배정 CRUD 왕복 확인.
