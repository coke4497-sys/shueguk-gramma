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
    "pho-10": { title: "음운 변동 실습 (379~422)" },

    "ort-1":  { title: "총칙과 자모 (제1·2장)" },
    "ort-2":  { title: "된소리 (1)" },
    "ort-3":  { title: "된소리 (2)" },
    "ort-4":  { title: "구개음화 (1)" },
    "ort-5":  { title: "구개음화 (2)" },
    "ort-6":  { title: "'ㄷ' 소리 받침 (1)" },
    "ort-7":  { title: "'ㄷ' 소리 받침 (2)" },
    "ort-8":  { title: "모음 (1)" },
    "ort-9":  { title: "모음 (2)" },
    "ort-10": { title: "두음 법칙 (1)" },
    "ort-11": { title: "두음 법칙 (2)" },
    "ort-12": { title: "겹쳐 나는 소리 (1)" },
    "ort-13": { title: "겹쳐 나는 소리 (2)" },
    "ort-14": { title: "체언과 조사 (1)" },
    "ort-15": { title: "체언과 조사 (2)" },
    "ort-16": { title: "어간과 어미 (1)" },
    "ort-17": { title: "어간과 어미 (2)" },
    "ort-18": { title: "접미사가 붙어서 된 말 (1)" },
    "ort-19": { title: "접미사가 붙어서 된 말 (2)" },
    "ort-20": { title: "합성어 및 접두사가 붙은 말 (1)" },
    "ort-21": { title: "합성어 및 접두사가 붙은 말 (2)" },
    "ort-22": { title: "준말 (1)" },
    "ort-23": { title: "준말 (2)" },
    "ort-24": { title: "조사의 띄어쓰기 (1)" },
    "ort-25": { title: "조사의 띄어쓰기 (2)" },
    "ort-26": { title: "의존 명사·단위 명사 (1)" },
    "ort-27": { title: "의존 명사·단위 명사 (2)" },
    "ort-28": { title: "보조 용언 (1)" },
    "ort-29": { title: "보조 용언 (2)" },
    "ort-30": { title: "고유 명사 및 전문 용어 (1)" },
    "ort-31": { title: "고유 명사 및 전문 용어 (2)" },
    "ort-32": { title: "그 밖의 것 (제6장)" }
  }
};
