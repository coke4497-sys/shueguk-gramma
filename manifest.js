/* ===== 문법 테스트 목록 (manifest) =====
   - categories : 문법 카테고리 코드 / 화면 표시 라벨 (순서 = 화면 표시 순서)
   - tests      : 제작이 끝난 테스트만 등록. 키는 "카테고리코드-회차".
                  여기에 등록된 것만 링크 발송·배정·학생 응시가 활성화됩니다.
   - 문항 데이터는 data/{카테고리코드}-{회차}.json (어휘 테스트와 같은 방식)
*/
window.GRAMMA = {
  baseUrl: "https://coke4497-sys.github.io/shueguk-gramma/test.html",
  categories: [
    { code: "pho", label: "음운" },
    { code: "mor", label: "형태소" },
    { code: "pos", label: "품사" },
    { code: "wfm", label: "단어 형성법" },
    { code: "sen", label: "문장" },
    { code: "hon", label: "높임법" },
    { code: "cap", label: "사동과 피동" },
    { code: "ten", label: "시제와 부정 표현" },
    { code: "ort", label: "한글 맞춤법" },
    { code: "mid", label: "중세 국어" }
  ],
  tests: {
    "pho-1":  { title: "음운 변동 실습 (1~42)" },
    "pho-2":  { title: "음운 변동 실습 (43~84)" },
    "pho-3":  { title: "음운 변동 실습 (85~126)" },
    "pho-4":  { title: "음운 변동 실습 (127~168)" },
    "pho-5":  { title: "음운 변동 실습 (169~210)" },
    "pho-6":  { title: "음운 변동 실습 (211~252)" },
    "pho-7":  { title: "음운 변동 실습 (253~294)" },
    "pho-8":  { title: "음운 변동 실습 (295~336)" },
    "pho-9":  { title: "음운 변동 실습 (337~378)" },
    "pho-10": { title: "음운 변동 실습 (379~422)" }
  }
};
