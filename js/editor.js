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
    document.getElementById("btn-math-kbd").addEventListener("click", () => {
      const kb = window.mathVirtualKeyboard;
      if (!kb) return;
      mf.focus();
      if (kb.visible) kb.hide();
      else kb.show();
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
      if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.hide();
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
      this.toolbar.append(
        add("<b>B</b>", "굵게", () => this.exec("bold")),
        add("<u>U</u>", "밑줄(배운 용어 표시)", () => this.exec("underline")),
        add('<span style="color:#c0392b">가</span>', "빨간 강조", () => this.wrap("em")),
        add('<span style="background:#E9D8A6;padding:0 3px;border-radius:3px">가</span>', "형광펜", () => this.wrap("hl")),
        add("⌫서식", "서식 지우기", () => this.clearFormat()),
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
        if (sel.rangeCount && this.body.contains(sel.anchorNode)) this.lastRange = sel.getRangeAt(0).cloneRange();
        this.updateTableState();
      };
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
    }

    wrap(cls) {
      this.body.focus();
      this.restore();
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return;
      const r = sel.getRangeAt(0);
      if (!this.body.contains(r.commonAncestorContainer)) return;
      const span = document.createElement("span");
      span.className = cls;
      span.append(r.extractContents());
      r.insertNode(span);
      sel.removeAllRanges();
      const nr = document.createRange();
      nr.selectNodeContents(span);
      sel.addRange(nr);
      this.changed();
    }

    clearFormat() {
      this.body.focus();
      this.restore();
      document.execCommand("removeFormat", false, null);
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const r = sel.getRangeAt(0);
        this.body.querySelectorAll("span.em, span.hl").forEach((s) => {
          if (r.intersectsNode(s)) s.replaceWith(...s.childNodes);
        });
      }
      this.changed();
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
