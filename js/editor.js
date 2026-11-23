// 서식 입력칸(굵게·밑줄·강조·수식·표), 답안 HTML 정리, 복사·붙여넣기 막기
(function () {
  const Ed = (window.Ed = {});

  // ---------------------------------------------------------------- HTML 정리
  const ALLOWED_CLASSES = new Set(["math", "em", "hl"]);
  Ed.sanitize = function (html) {
    if (!html || typeof html !== "string") return "";
    const clean = window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["b", "strong", "i", "u", "br", "p", "div", "span", "table", "thead", "tbody", "tr", "td", "th", "ul", "ol", "li"],
      ALLOWED_ATTR: ["class", "data-latex", "colspan", "rowspan"],
      RETURN_DOM_FRAGMENT: true,
    });
    clean.querySelectorAll("[class]").forEach((el) => {
      const keep = [...el.classList].filter((c) => ALLOWED_CLASSES.has(c));
      if (keep.length) el.className = keep.join(" ");
      else el.removeAttribute("class");
    });
    clean.querySelectorAll("[data-latex]").forEach((el) => {
      if (!el.classList.contains("math")) el.removeAttribute("data-latex");
      else el.textContent = "";
    });
    const box = document.createElement("div");
    box.append(clean);
    return box.innerHTML;
  };

  Ed.latexMarkup = function (latex) {
    try {
      return window.MathLive.convertLatexToMarkup(latex || "");
    } catch (e) {
      return "";
    }
  };

  // .math[data-latex] 안에 수식 그림을 채운다
  Ed.renderMath = function (root) {
    root.querySelectorAll(".math[data-latex]").forEach((el) => {
      el.innerHTML = Ed.latexMarkup(el.getAttribute("data-latex"));
      el.setAttribute("contenteditable", "false");
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", "수식 " + el.getAttribute("data-latex"));
    });
  };

  // 입력칸 DOM → 저장용 HTML (수식 그림은 빼고 latex만 남긴다)
  Ed.serialize = function (root) {
    const copy = root.cloneNode(true);
    copy.querySelectorAll(".math").forEach((el) => {
      el.textContent = "";
      el.removeAttribute("contenteditable");
      el.removeAttribute("role");
      el.removeAttribute("aria-label");
    });
    copy.querySelectorAll(".cell-active").forEach((el) => el.classList.remove("cell-active"));
    // 서식 켜기/끄기에 쓰는 보이지 않는 글자(​)와 빈 서식 덩어리를 지운다
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach((t) => {
      if (t.nodeValue.includes("​")) t.nodeValue = t.nodeValue.replace(/​/g, "");
    });
    copy.querySelectorAll("span.em, span.hl, b, strong, u").forEach((el) => {
      if (!el.textContent && !el.querySelector(".math, br, table")) el.remove();
    });
    const html = Ed.sanitize(copy.innerHTML);
    return Ed.textOf(html) || /class="math"/.test(html) || /<table/.test(html) ? html : "";
  };

  Ed.textOf = function (html) {
    const d = document.createElement("div");
    d.innerHTML = html || "";
    return (d.textContent || "").replace(/\s+/g, " ").trim();
  };
  Ed.isFilled = function (html) {
    return !!html && (Ed.textOf(html).length > 0 || /class="math"/.test(html));
  };

  // ---------------------------------------------------------------- 복사·붙여넣기 막기
  let guardOn = false;
  let notify = () => {};
  Ed.setGuard = function (on, onBlocked) {
    guardOn = on;
    if (onBlocked) notify = onBlocked;
  };
  const block = (msg) => (e) => {
    if (!guardOn) return;
    e.preventDefault();
    e.stopPropagation();
    notify(msg);
  };
  ["paste", "drop"].forEach((t) => window.addEventListener(t, block("붙여넣기는 할 수 없어요. 직접 입력해 주세요."), true));
  ["copy", "cut"].forEach((t) => window.addEventListener(t, block("복사·잘라내기는 할 수 없어요."), true));
  window.addEventListener("dragstart", block("끌어서 옮기기는 할 수 없어요."), true);
  window.addEventListener(
    "contextmenu",
    (e) => {
      if (guardOn && e.target.closest && e.target.closest(".rte, .term-head, math-field, input")) {
        e.preventDefault();
      }
    },
    true
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (!guardOn) return;
      const k = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ["v", "c", "x"].includes(k)) {
        e.preventDefault();
        e.stopPropagation();
        notify(k === "v" ? "붙여넣기는 할 수 없어요. 직접 입력해 주세요." : "복사·잘라내기는 할 수 없어요.");
      }
      if (e.shiftKey && k === "insert") {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
  window.addEventListener(
    "beforeinput",
    (e) => {
      if (!guardOn) return;
      const t = e.inputType || "";
      const pasted = t === "insertFromPaste" || t === "insertFromPasteAsQuotation" || t === "insertFromDrop" || t === "insertFromYank";
      // 일부 모바일 자판은 클립보드 내용을 insertText 한 번으로 넣는다
      const bulk = (t === "insertText" || t === "insertReplacementText") && e.data && e.data.length > 25;
      if (pasted || bulk) {
        e.preventDefault();
        notify("붙여넣기는 할 수 없어요. 직접 입력해 주세요.");
      }
    },
    true
  );

  // ---------------------------------------------------------------- 수식 대화상자
  const PALETTE = [
    ["\\frac{a}{b}", "\\frac{#0}{#?}"],
    ["x^{n}", "#@^{#?}"],
    ["a_{n}", "#@_{#?}"],
    ["\\sqrt{x}", "\\sqrt{#0}"],
    ["\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "\\begin{pmatrix}#0 & #? \\\\ #? & #?\\end{pmatrix}"],
    ["\\begin{pmatrix}a&b&c\\\\d&e&f\\end{pmatrix}", "\\begin{pmatrix}#0 & #? & #? \\\\ #? & #? & #?\\end{pmatrix}"],
    ["\\begin{pmatrix}a\\\\b\\\\c\\end{pmatrix}", "\\begin{pmatrix}#0 \\\\ #? \\\\ #?\\end{pmatrix}"],
    ["\\begin{pmatrix}a\\\\b\\end{pmatrix}", "\\begin{pmatrix}#0 \\\\ #?\\end{pmatrix}"],
    ["\\times", "\\times"],
    ["\\div", "\\div"],
    ["\\le", "\\le"],
    ["\\ge", "\\ge"],
    ["\\ne", "\\ne"],
    ["\\to", "\\to"],
    ["\\Rightarrow", "\\Rightarrow"],
    ["\\Delta", "\\Delta"],
    ["\\alpha", "\\alpha"],
    ["\\sum", "\\sum_{#0}^{#?}"],
    ["P_{0}", "P_{0}"],
    ["Q_{0}", "Q_{0}"],
  ];

  let mathCtx = null; // {editor, target(span|null), range}
  function setupMathDialog() {
    const dlg = document.getElementById("dlg-math");
    const mf = document.getElementById("mf");
    const pal = document.getElementById("math-palette");
    if (!dlg || dlg.dataset.ready) return;
    dlg.dataset.ready = "1";
    if (mf) {
      mf.smartFence = true;
      mf.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          document.getElementById("btn-math-ok").click();
        }
      });
    }
    PALETTE.forEach(([show, insert]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = Ed.latexMarkup(show);
      b.setAttribute("aria-label", "수식 넣기 " + show);
      b.addEventListener("click", () => {
        mf.focus();
        if (insert.includes("\\begin")) {
          // MathLive 0.98 은 행렬 환경을 insert 로 넣지 못해서 끝에 붙이고 첫 빈칸으로 옮긴다
          const cur = mf.value || "";
          const skip = (cur.match(/\\placeholder/g) || []).length;
          mf.value = cur + insert.replace(/#[0?@]/g, "\\placeholder{}");
          mf.executeCommand("moveToMathfieldStart");
          for (let i = 0; i <= skip; i++) mf.executeCommand("moveToNextPlaceholder");
        } else {
          mf.insert(insert, { selectionMode: "placeholder", focus: true });
        }
        mf.focus();
      });
      pal.append(b);
    });
    // 수식 키보드는 기본으로 화면 맨 아래(body)에 떠서 대화상자 뒤에 가려진다
    // → 대화상자 안, 입력칸 바로 아래 칸(#mf-kbd)에 띄운다
    const kb = window.mathVirtualKeyboard;
    const kbBox = document.getElementById("mf-kbd");
    const kbBtn = document.getElementById("btn-math-kbd");
    const fitToKeyboard = (on) => {
      dlg.classList.toggle("kbd-open", !!on);
      kbBox.hidden = !on;
      kbBtn.textContent = on ? "⌨ 키보드 닫기" : "⌨ 수식 키보드";
      kbBtn.setAttribute("aria-pressed", String(!!on));
    };
    kbBtn.addEventListener("click", () => {
      if (!kb) return;
      if (dlg.classList.contains("kbd-open")) {
        kb.hide();
        fitToKeyboard(false);
      } else {
        fitToKeyboard(true);
        try {
          kb.container = kbBox;
        } catch (e) {}
        mf.focus();
        kb.show();
      }
      mf.focus();
    });
    document.getElementById("btn-math-ok").addEventListener("click", () => {
      const latex = (mf.value || "").trim();
      if (mathCtx) {
        if (latex) mathCtx.editor.putMath(latex, mathCtx);
        else if (mathCtx.target) mathCtx.target.remove();
        mathCtx.editor.changed();
      }
      closeMath();
    });
    document.getElementById("btn-math-delete").addEventListener("click", () => {
      if (mathCtx && mathCtx.target) {
        mathCtx.target.remove();
        mathCtx.editor.changed();
      }
      closeMath();
    });
    dlg.addEventListener("close", () => {
      if (kb) {
        kb.hide();
        try {
          kb.container = document.body;
        } catch (e) {}
      }
      fitToKeyboard(false);
      mathCtx = null;
    });
  }
  function closeMath() {
    const dlg = document.getElementById("dlg-math");
    if (dlg.open) dlg.close();
  }
  function openMath(ctx) {
    setupMathDialog();
    mathCtx = ctx;
    const dlg = document.getElementById("dlg-math");
    const mf = document.getElementById("mf");
    document.getElementById("btn-math-delete").hidden = !ctx.target;
    document.getElementById("btn-math-ok").textContent = ctx.target ? "고치기" : "넣기";
    mf.value = ctx.target ? ctx.target.getAttribute("data-latex") || "" : "";
    dlg.showModal();
    setTimeout(() => mf.focus(), 50);
  }

  // ---------------------------------------------------------------- 표 대화상자
  let tableCtx = null;
  let pick = { r: 3, c: 3 };
  function setupTableDialog() {
    const dlg = document.getElementById("dlg-table");
    if (!dlg || dlg.dataset.ready) return;
    dlg.dataset.ready = "1";
    const grid = document.getElementById("table-picker");
    const size = document.getElementById("table-size");
    const paint = (r, c) => {
      grid.querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.r <= r && +b.dataset.c <= c));
      size.textContent = `${r} × ${c}`;
    };
    for (let r = 1; r <= 8; r++)
      for (let c = 1; c <= 8; c++) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.r = r;
        b.dataset.c = c;
        b.setAttribute("aria-label", `${r}행 ${c}열`);
        b.addEventListener("mouseenter", () => paint(r, c));
        b.addEventListener("focus", () => paint(r, c));
        b.addEventListener("click", () => {
          pick = { r, c };
          paint(r, c);
        });
        grid.append(b);
      }
    grid.addEventListener("mouseleave", () => paint(pick.r, pick.c));
    paint(3, 3);
    document.getElementById("btn-table-ok").addEventListener("click", () => {
      if (tableCtx) tableCtx.editor.putTable(pick.r, pick.c, document.getElementById("chk-thead").checked, tableCtx.range);
      dlg.close();
    });
    dlg.addEventListener("close", () => (tableCtx = null));
  }
  function openTable(ctx) {
    setupTableDialog();
    tableCtx = ctx;
    document.getElementById("dlg-table").showModal();
  }

  // ---------------------------------------------------------------- 입력칸
  class RichEditor {
    constructor(slot, opts) {
      this.opts = opts || {};
      this.readOnly = !!this.opts.readOnly;
      this.root = document.createElement("div");
      this.root.className = "rte" + (this.readOnly ? " readonly" : "");
      this.toolbar = document.createElement("div");
      this.toolbar.className = "rte-toolbar";
      this.toolbar.setAttribute("role", "toolbar");
      this.toolbar.setAttribute("aria-label", "서식 도구");
      this.body = document.createElement("div");
      this.body.className = "rte-body rich";
      this.body.setAttribute("role", "textbox");
      this.body.setAttribute("aria-multiline", "true");
      if (this.opts.label) this.body.setAttribute("aria-label", this.opts.label);
      this.body.dataset.placeholder = this.opts.placeholder || "";
      this.body.contentEditable = this.readOnly ? "false" : "true";
      this.body.spellcheck = false;
      this.root.append(this.toolbar, this.body);
      slot.replaceChildren(this.root);
      this.lastRange = null;
      this.buildToolbar();
      this.bind();
    }

    buildToolbar() {
      const add = (label, title, fn, cls) => {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = label;
        b.title = title;
        b.setAttribute("aria-label", title);
        if (cls) b.className = cls;
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => {
          if (this.readOnly) return;
          fn();
        });
        return b;
      };
      const sep = () => Object.assign(document.createElement("span"), { className: "sep" });
      // 한글(HWP)처럼 한 번 누르면 켜지고, 다시 누르면 꺼진다(켜진 버튼은 파랗게 표시)
      this.fmtBtns = {
        bold: add("<b>B</b>", "굵게 (켜기/끄기, Ctrl+B)", () => this.exec("bold"), "tb-fmt"),
        underline: add("<u>U</u>", "밑줄 — 배운 용어 표시 (켜기/끄기, Ctrl+U)", () => this.exec("underline"), "tb-fmt"),
        em: add('<span style="color:#c0392b">가</span>', "빨간 글씨 (켜기/끄기)", () => this.toggleSpan("em"), "tb-fmt"),
        hl: add('<span style="background:#E9D8A6;padding:0 3px;border-radius:3px">가</span>', "형광펜 (켜기/끄기)", () => this.toggleSpan("hl"), "tb-fmt"),
      };
      Object.values(this.fmtBtns).forEach((b) => b.setAttribute("aria-pressed", "false"));
      this.toolbar.append(
        ...Object.values(this.fmtBtns),
        sep(),
        add("∑ 수식", "수식 넣기", () => this.openMath(null), "tb-math"),
        add("▦ 표", "표 넣기", () => this.openTable(), "tb-table")
      );
      const tt = document.createElement("span");
      tt.className = "table-tools";
      tt.append(
        sep(),
        add("행+", "아래에 행 추가", () => this.tableOp("addRow")),
        add("열+", "오른쪽에 열 추가", () => this.tableOp("addCol")),
        add("행−", "이 행 삭제", () => this.tableOp("delRow")),
        add("열−", "이 열 삭제", () => this.tableOp("delCol")),
        add("표✕", "표 삭제", () => this.tableOp("delTable"))
      );
      this.toolbar.append(tt);
    }

    bind() {
      this.body.addEventListener("input", () => this.changed());
      const remember = () => {
        const sel = window.getSelection();
        if (sel.rangeCount && this.body.contains(sel.anchorNode)) {
          this.lastRange = sel.getRangeAt(0).cloneRange();
          this.updateFormatState();
        }
        this.updateTableState();
      };
      this.body.addEventListener("keyup", () => this.updateFormatState());
      document.addEventListener("selectionchange", remember);
      this.body.addEventListener("click", (e) => {
        const m = e.target.closest(".math");
        if (m && this.body.contains(m) && !this.readOnly) {
          e.preventDefault();
          this.openMath(m);
        }
      });
      this.body.addEventListener("keydown", (e) => {
        if (this.readOnly) return;
        if (e.key === "Tab") {
          const cell = this.currentCell();
          if (cell) {
            e.preventDefault();
            const cells = [...cell.closest("table").querySelectorAll("td,th")];
            const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
            if (next) this.placeCaret(next);
            else if (!e.shiftKey) {
              this.tableOp("addRow");
            }
          }
        }
      });
    }

    exec(cmd) {
      this.body.focus();
      this.restore();
      document.execCommand(cmd, false, null);
      this.changed();
      this.updateFormatState();
    }

    spanAt(node, cls) {
      let n = node && node.nodeType === 3 ? node.parentElement : node;
      const s = n && n.closest ? n.closest("span." + cls) : null;
      return s && this.body.contains(s) ? s : null;
    }

    caretAt(node, offset) {
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      this.lastRange = r.cloneRange();
    }

    // 빨간 글씨·형광펜 켜기/끄기
    toggleSpan(cls) {
      this.body.focus();
      this.restore();
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      if (!this.body.contains(r.commonAncestorContainer)) return;
      const ZW = "​";
      const hasText = (n) => (n.textContent || "").replace(/​/g, "").length > 0;
      const unwrapIn = (root) => root.querySelectorAll && root.querySelectorAll("span." + cls).forEach((x) => x.replaceWith(...x.childNodes));
      const startSpan = this.spanAt(r.startContainer, cls);
      const endSpan = this.spanAt(r.endContainer, cls);

      if (r.collapsed) {
        if (startSpan) {
          // 끄기: 커서 위치에서 서식 덩어리를 나누고, 커서를 바깥으로 뺀다
          const right = document.createRange();
          right.setStart(r.startContainer, r.startOffset);
          right.setEnd(startSpan, startSpan.childNodes.length);
          const rest = right.extractContents();
          const z = document.createTextNode(ZW);
          startSpan.after(z);
          if (hasText(rest)) {
            const ns = document.createElement("span");
            ns.className = cls;
            ns.append(rest);
            z.after(ns);
          }
          if (!hasText(startSpan)) startSpan.remove();
          this.caretAt(z, 1);
        } else {
          // 켜기: 이제부터 입력하는 글자에 서식이 붙는다
          const s = document.createElement("span");
          s.className = cls;
          const z = document.createTextNode(ZW);
          s.append(z);
          r.insertNode(s);
          this.caretAt(z, 1);
        }
      } else if (startSpan && startSpan === endSpan) {
        // 끄기: 고른 부분만 서식을 벗긴다
        const frag = r.extractContents();
        unwrapIn(frag);
        const right = document.createRange();
        right.setStart(r.startContainer, r.startOffset);
        right.setEnd(startSpan, startSpan.childNodes.length);
        const rest = right.extractContents();
        const nodes = [...frag.childNodes];
        startSpan.after(frag);
        const last = nodes[nodes.length - 1] || startSpan;
        if (hasText(rest)) {
          const ns = document.createElement("span");
          ns.className = cls;
          ns.append(rest);
          last.after(ns);
        }
        if (!hasText(startSpan)) startSpan.remove();
        if (nodes.length) {
          const nr = document.createRange();
          nr.setStartBefore(nodes[0]);
          nr.setEndAfter(last);
          sel.removeAllRanges();
          sel.addRange(nr);
          this.lastRange = nr.cloneRange();
        }
      } else {
        // 켜기: 고른 부분 전체에 서식
        const frag = r.extractContents();
        unwrapIn(frag);
        const s = document.createElement("span");
        s.className = cls;
        s.append(frag);
        r.insertNode(s);
        const nr = document.createRange();
        nr.selectNodeContents(s);
        sel.removeAllRanges();
        sel.addRange(nr);
        this.lastRange = nr.cloneRange();
      }
      this.changed();
      this.updateFormatState();
    }

    updateFormatState() {
      if (!this.fmtBtns) return;
      const sel = window.getSelection();
      const inside = sel.rangeCount && this.body.contains(sel.anchorNode);
      const st = { bold: false, underline: false, em: false, hl: false };
      if (inside) {
        try {
          st.bold = document.queryCommandState("bold");
          st.underline = document.queryCommandState("underline");
        } catch (e) {}
        st.em = !!this.spanAt(sel.anchorNode, "em");
        st.hl = !!this.spanAt(sel.anchorNode, "hl");
      }
      Object.entries(this.fmtBtns).forEach(([k, b]) => {
        b.classList.toggle("on", st[k]);
        b.setAttribute("aria-pressed", String(st[k]));
      });
    }

    restore() {
      if (!this.lastRange) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(this.lastRange);
    }

    placeCaret(node, atEnd) {
      const r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(!atEnd);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      this.lastRange = r.cloneRange();
      this.updateTableState();
    }

    insertNodeAtRange(node, range) {
      let r = range;
      if (!r || !this.body.contains(r.commonAncestorContainer)) {
        r = document.createRange();
        r.selectNodeContents(this.body);
        r.collapse(false);
      }
      r.deleteContents();
      r.insertNode(node);
      return r;
    }

    openMath(target) {
      openMath({ editor: this, target, range: this.lastRange ? this.lastRange.cloneRange() : null });
    }

    putMath(latex, ctx) {
      if (ctx.target && this.body.contains(ctx.target)) {
        ctx.target.setAttribute("data-latex", latex);
        Ed.renderMath(ctx.target.parentNode);
        return;
      }
      const span = document.createElement("span");
      span.className = "math";
      span.setAttribute("data-latex", latex);
      this.body.focus();
      this.insertNodeAtRange(span, ctx.range);
      const space = document.createTextNode(" ");
      span.after(space);
      Ed.renderMath(span.parentNode);
      const r = document.createRange();
      r.setStartAfter(space);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      this.lastRange = r.cloneRange();
    }

    openTable() {
      openTable({ editor: this, range: this.lastRange ? this.lastRange.cloneRange() : null });
    }

    putTable(rows, cols, head, range) {
      const t = document.createElement("table");
      const tb = document.createElement("tbody");
      for (let i = 0; i < rows; i++) {
        const tr = document.createElement("tr");
        for (let j = 0; j < cols; j++) {
          const cell = document.createElement(head && i === 0 ? "th" : "td");
          cell.append(document.createElement("br"));
          tr.append(cell);
        }
        tb.append(tr);
      }
      t.append(tb);
      this.body.focus();
      let r = range;
      // 표 안에 표를 넣지 않는다
      if (r && r.commonAncestorContainer && r.commonAncestorContainer.parentElement && r.commonAncestorContainer.parentElement.closest && r.commonAncestorContainer.parentElement.closest("table")) {
        const outer = r.commonAncestorContainer.parentElement.closest("table");
        r = document.createRange();
        r.setStartAfter(outer);
        r.collapse(true);
      }
      this.insertNodeAtRange(t, r);
      const after = document.createElement("div");
      after.append(document.createElement("br"));
      t.after(after);
      this.placeCaret(t.querySelector("td,th"));
      this.changed();
    }

    currentCell() {
      const sel = window.getSelection();
      if (!sel.rangeCount) return null;
      let n = sel.anchorNode;
      if (!n || !this.body.contains(n)) return null;
      if (n.nodeType === 3) n = n.parentElement;
      const cell = n.closest && n.closest("td,th");
      return cell && this.body.contains(cell) ? cell : null;
    }

    updateTableState() {
      const cell = this.currentCell();
      this.root.classList.toggle("in-table", !!cell);
      this.body.querySelectorAll(".cell-active").forEach((c) => c !== cell && c.classList.remove("cell-active"));
      if (cell) cell.classList.add("cell-active");
      this.activeCell = cell;
    }

    tableOp(op) {
      const cell = this.currentCell() || this.activeCell;
      if (!cell || !this.body.contains(cell)) return;
      const tr = cell.parentElement;
      const table = cell.closest("table");
      const idx = [...tr.children].indexOf(cell);
      if (op === "addRow") {
        const nr = document.createElement("tr");
        for (let i = 0; i < tr.children.length; i++) {
          const c = document.createElement("td");
          c.append(document.createElement("br"));
          nr.append(c);
        }
        tr.after(nr);
        this.placeCaret(nr.children[Math.min(idx, nr.children.length - 1)]);
      } else if (op === "addCol") {
        table.querySelectorAll("tr").forEach((row) => {
          const ref = row.children[idx];
          const c = document.createElement(ref && ref.tagName === "TH" ? "th" : "td");
          c.append(document.createElement("br"));
          if (ref) ref.after(c);
          else row.append(c);
        });
        this.placeCaret(tr.children[idx + 1]);
      } else if (op === "delRow") {
        const rows = table.querySelectorAll("tr");
        if (rows.length <= 1) return this.tableOp("delTable");
        const next = tr.nextElementSibling || tr.previousElementSibling;
        tr.remove();
        this.placeCaret(next.children[Math.min(idx, next.children.length - 1)]);
      } else if (op === "delCol") {
        if (tr.children.length <= 1) return this.tableOp("delTable");
        table.querySelectorAll("tr").forEach((row) => row.children[idx] && row.children[idx].remove());
        this.placeCaret(tr.children[Math.max(0, idx - 1)]);
      } else if (op === "delTable") {
        const after = document.createElement("div");
        after.append(document.createElement("br"));
        table.replaceWith(after);
        this.placeCaret(after);
      }
      this.changed();
    }

    changed() {
      if (this.opts.onChange) this.opts.onChange();
    }

    getHTML() {
      return Ed.serialize(this.body);
    }

    setHTML(html) {
      this.body.innerHTML = Ed.sanitize(html || "");
      Ed.renderMath(this.body);
    }

    setReadOnly(ro) {
      this.readOnly = ro;
      this.body.contentEditable = ro ? "false" : "true";
      this.root.classList.toggle("readonly", ro);
    }
  }
  Ed.RichEditor = RichEditor;

  // 보기용: 저장된 HTML을 안전하게 그려 넣는다
  Ed.renderInto = function (el, html) {
    el.classList.add("rich");
    el.innerHTML = Ed.sanitize(html || "");
    Ed.renderMath(el);
    el.querySelectorAll("table").forEach((t) => {
      const w = document.createElement("div");
      w.className = "table-scroll";
      t.replaceWith(w);
      w.append(t);
    });
  };
})();
