// 답안 자료 구조, 작성 정도 계산, 보기·PDF용 답안지 그리기
(function () {
  const Sheet = (window.Sheet = {});

  Sheet.TERM_ROWS = [
    { key: "meaning", label: "① 정확한 의미", hint: "용어의 뜻을 정확하게", ph: "예: 상품의 가격과 소비자가 사려고 하는 수량(수요량)의 관계를 나타낸 함수이다." },
    { key: "math", label: "② 수학적 표현 및 설명", hint: "식·그래프·표·행렬", ph: "예: 가격을 P, 수요량을 Q라 하면 Q = d(P) = −aP + b (a>0, b>0). ∑ 수식, ▦ 표 버튼을 써 보세요." },
    { key: "apply", label: "③ 위 상황에 적용하기", hint: "생각열기 상황에 적용", ph: "예: 떡볶이 한 컵의 가격이 2,000원일 때 수요량이 200컵이므로 d(2000) = 200 …" },
  ];

  Sheet.empty = function () {
    return {
      v: 1,
      thinking: { method: "", cartoonText: "", writing: "", checks: { terms: false, vars: false, form: false } },
      terms: [0, 1, 2].map(() => ({ name: "", unit: "", meaning: "", math: "", apply: "" })),
    };
  };

  Sheet.normalize = function (c) {
    const e = Sheet.empty();
    if (!c || typeof c !== "object") return e;
    const t = c.thinking || {};
    e.thinking.method = t.method === "cartoon" || t.method === "writing" ? t.method : "";
    e.thinking.cartoonText = typeof t.cartoonText === "string" ? t.cartoonText : "";
    e.thinking.writing = typeof t.writing === "string" ? t.writing : "";
    const ch = t.checks || {};
    e.thinking.checks = { terms: !!ch.terms, vars: !!ch.vars, form: !!ch.form };
    if (Array.isArray(c.terms))
      c.terms.slice(0, 3).forEach((x, i) => {
        if (!x || typeof x !== "object") return;
        ["name", "unit", "meaning", "math", "apply"].forEach((k) => {
          if (typeof x[k] === "string") e.terms[i][k] = x[k];
        });
      });
    return e;
  };

  // 작성 정도: 생각열기 done 여부, 용어마다 채운 칸 수(0~3)
  Sheet.progress = function (content, imageCount) {
    const c = Sheet.normalize(content);
    const filled = window.Ed.isFilled;
    const t = c.thinking;
    const thinking =
      t.method === "writing" ? filled(t.writing) : t.method === "cartoon" ? imageCount > 0 || filled(t.cartoonText) : false;
    const terms = c.terms.map((x) => Sheet.TERM_ROWS.filter((r) => filled(x[r.key])).length);
    const named = c.terms.map((x) => !!x.name.trim());
    const complete = thinking && terms.every((n, i) => n === 3 && named[i]);
    return { method: t.method, thinking, terms, named, complete };
  };

  const fmt = (iso) => {
    if (!iso) return "-";
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  Sheet.fmt = fmt;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function richBox(html) {
    const d = el("div");
    if (window.Ed.isFilled(html)) window.Ed.renderInto(d, html);
    else {
      d.className = "paper-empty";
      d.textContent = "(작성하지 않음)";
    }
    return d;
  }

  // student: {student_id, name, updated_at, created_at, content}, images: [{id,data}]
  Sheet.renderPaper = function (student, images) {
    const c = Sheet.normalize(student.content);
    const paper = el("div", "paper");
    const title = el("div", "paper-title");
    title.append(el("h1", null, "내가 만드는 경제수학 용어사전"));
    const who = el("div", "paper-who");
    who.append(el("div", null, `학번 ${student.student_id}   이름 ${student.name}`));
    who.append(el("div", null, `마지막 수정 ${fmt(student.updated_at)}`));
    title.append(who);
    paper.append(title);

    // (1) 생각열기
    const b1 = el("div", "paper-band");
    b1.append(document.createTextNode("(1) 생각열기 : 나의 경제 상황 "));
    b1.append(el("small", null, c.thinking.method === "cartoon" ? "· 방법 ① 네컷만화" : c.thinking.method === "writing" ? "· 방법 ② 줄글" : "· 방법 선택 안 함"));
    paper.append(b1);
    const box = el("div", "paper-box");
    if (c.thinking.method === "cartoon") {
      if (images && images.length) {
        const g = el("div", "paper-photos");
        images.forEach((im) => {
          const img = el("img");
          img.src = im.data;
          img.alt = "네컷만화 사진";
          g.append(img);
        });
        box.append(g);
      } else box.append(el("div", "paper-empty", "(사진 없음)"));
      if (window.Ed.isFilled(c.thinking.cartoonText)) box.append(richBox(c.thinking.cartoonText));
    } else if (c.thinking.method === "writing") {
      box.append(richBox(c.thinking.writing));
    } else box.append(el("div", "paper-empty", "(작성하지 않음)"));
    const ch = c.thinking.checks;
    box.append(
      el(
        "div",
        "paper-check",
        `나의 점검  ${ch.terms ? "☑" : "☐"} 용어 3개 이상 포함   ${ch.vars ? "☑" : "☐"} 대상과 변수가 분명함   ${ch.form ? "☑" : "☐"} 네컷 또는 2문장 이상으로 완성`
      )
    );
    paper.append(box);

    // (2) 용어사전
    const b2 = el("div", "paper-band", "(2) 용어사전");
    paper.append(b2);
    c.terms.forEach((t, i) => {
      const term = el("div", "paper-term");
      const head = el("div", "paper-term-head");
      head.append(document.createTextNode(`용어 ${"①②③"[i]} ${t.name.trim() || "(용어 이름 없음)"}`));
      term.append(head);
      Sheet.TERM_ROWS.forEach((r) => {
        const row = el("div", "paper-row" + (r.key === "apply" ? " apply" : ""));
        row.append(el("div", null, r.label));
        row.append(richBox(t[r.key]));
        term.append(row);
      });
      paper.append(term);
    });

    // 점수표(교사가 손으로 채점)
    const score = el("table", "paper-score");
    score.innerHTML =
      "<thead><tr><th>평가 요소</th><th>① 정확한 의미</th><th>② 수학적 표현 및 설명</th><th>③ 상황 적용</th><th>소계</th></tr></thead>" +
      "<tbody>" +
      c.terms
        .map((t, i) => `<tr><td>용어 ${"①②③"[i]}</td><td>2 · 0</td><td>2 · 0</td><td>2 · 0</td><td>&nbsp;/ 6</td></tr>`)
        .join("") +
      "<tr><td>(1) 생각열기</td><td colspan='3'>4 · 2 · 0</td><td>&nbsp;/ 4</td></tr>" +
      "<tr><td>기본점수</td><td colspan='3'>모든 학생에게 부여</td><td>8</td></tr>" +
      "<tr><th>합계</th><td colspan='3'>생각열기 4 + 용어 18 + 기본점수 8 (만점 30점)</td><th>&nbsp;/ 30</th></tr></tbody>";
    paper.append(score);
    return paper;
  };
})();
