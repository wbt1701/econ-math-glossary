// 화면 흐름: 첫 화면 → 학생 답안 작성 / 교사 대시보드
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const cfg = window.APP_CONFIG || {};
  const LS_STUDENT = "emg.student";
  const LS_TEACHER = "emg.teacher";

  const store = {
    get(k) {
      try {
        return sessionStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        sessionStorage.setItem(k, v);
      } catch (e) {}
    },
    del(k) {
      try {
        sessionStorage.removeItem(k);
      } catch (e) {}
    },
  };

  // ---------------------------------------------------------------- 공통
  let toastTimer = null;
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("error", !!isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }

  const ERR = {
    CLOSED: "지금은 접속 가능 시간이 아니에요.",
    NAME_MISMATCH: "이 학교·학번은 다른 이름으로 이미 입장했어요. 이름을 정확히 입력했는지 확인하고, 문제가 있으면 선생님께 말씀드리세요.",
    BAD_STUDENT_ID: "학번은 숫자 5자리로 입력해 주세요.",
    BAD_NAME: "이름을 1~20자로 입력해 주세요.",
    BAD_SCHOOL: "학교 이름을 2~30자로 입력해 주세요. (예: 풍산고등학교)",
    SESSION_EXPIRED: "다른 기기(창)에서 같은 학번으로 입장해서 이 화면은 저장할 수 없어요. 다시 입장해 주세요.",
    TOO_LARGE: "내용이 너무 길어요. 표나 수식을 조금 줄여 주세요.",
    BAD_IMAGE: "사진을 올리지 못했어요. 다른 사진으로 해 보세요.",
    TOO_MANY_IMAGES: "사진은 4장까지 올릴 수 있어요.",
    WRONG_PASSWORD: "비밀번호가 맞지 않아요.",
    TOO_MANY_ATTEMPTS: "비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 시도해 주세요.",
    TEACHER_AUTH: "교사 로그인이 끝났어요. 다시 로그인해 주세요.",
    BAD_WINDOW: "마감 시각은 시작 시각보다 뒤여야 해요.",
    NETWORK: "인터넷 연결이 불안정해요. 잠시 뒤 자동으로 다시 시도합니다.",
  };
  class AppError extends Error {
    constructor(code, raw) {
      super(ERR[code] || raw || "알 수 없는 오류가 났어요.");
      this.code = code;
    }
  }

  let sb = null;
  async function rpc(name, args) {
    let res;
    try {
      res = await sb.rpc(name, args || {});
    } catch (e) {
      throw new AppError("NETWORK");
    }
    if (res.error) {
      const m = String(res.error.message || "");
      const code = Object.keys(ERR).find((k) => m.includes(k));
      if (!code && (/fetch|network|Failed/i.test(m) || res.status === 0)) throw new AppError("NETWORK");
      throw new AppError(code || "UNKNOWN", m);
    }
    return res.data;
  }

  // 서버 시계와의 차이(ms)
  let clockSkew = 0;
  const serverNow = () => Date.now() + clockSkew;
  function absorbStatus(st) {
    if (st && st.now) clockSkew = new Date(st.now).getTime() - Date.now();
    return st;
  }
  function isOpenLocal(st) {
    if (!st || !st.open_at || !st.close_at) return false;
    const n = serverNow();
    return new Date(st.open_at).getTime() <= n && n < new Date(st.close_at).getTime();
  }
  const pad = (n) => String(n).padStart(2, "0");
  function fmtShort(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    const today = new Date(serverNow());
    const same = d.toDateString() === today.toDateString();
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return same ? `오늘 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }
  function fmtTime(iso) {
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function fmtLeft(ms) {
    if (ms <= 0) return "0분";
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    const s = Math.floor((ms % 60000) / 1000);
    if (h >= 24) return `${Math.floor(h / 24)}일 ${h % 24}시간`;
    if (h > 0) return `${h}시간 ${m % 60}분`;
    if (m >= 5) return `${m}분`;
    return `${m}분 ${s}초`;
  }
  function windowText(st) {
    if (!st || !st.open_at || !st.close_at) return { cls: "is-closed", text: "아직 접속 시간이 정해지지 않았어요" };
    const n = serverNow();
    const o = new Date(st.open_at).getTime();
    const c = new Date(st.close_at).getTime();
    if (n < o) return { cls: "is-closed", text: `${fmtShort(st.open_at)}부터 입장할 수 있어요 (마감 ${fmtShort(st.close_at)})` };
    if (n >= c) return { cls: "is-closed", text: `마감되었어요 (${fmtShort(st.close_at)})` };
    return { cls: "is-open", text: `지금 입장 가능 · 마감 ${fmtShort(st.close_at)} (${fmtLeft(c - n)} 남음)` };
  }

  function show(view) {
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    window.scrollTo(0, 0);
    Ed.setGuard(view === "student", (m) => toast(m, true));
  }

  function fatal(msg) {
    $("#fatal-msg").textContent = msg;
    show("error");
  }

  // ---------------------------------------------------------------- 첫 화면
  let entryStatus = null;
  let entryTimer = null;
  async function showEntry() {
    show("entry");
    $("#topbar-right").replaceChildren();
    clearInterval(entryTimer);
    const paint = () => {
      const w = windowText(entryStatus);
      const chip = $("#entry-window");
      chip.className = "window-chip " + w.cls;
      chip.textContent = w.text;
    };
    try {
      entryStatus = absorbStatus(await rpc("app_status"));
    } catch (e) {
      $("#entry-window").textContent = e.message;
    }
    paint();
    entryTimer = setInterval(async () => {
      if ($("#view-entry").hidden) return clearInterval(entryTimer);
      paint();
    }, 1000);
    setTimeout(() => ($("#in-school").value ? $("#in-sid") : $("#in-school")).focus(), 50);
  }

  $("#in-sid").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 5);
  });

  // 학교명은 이 기기에서 마지막으로 쓴 값을 채워 둔다(편의 기능, 저장 실패해도 상관없음)
  try {
    const last = localStorage.getItem("emg.school");
    if (last) $("#in-school").value = last;
  } catch (e) {}

  $("#form-student").addEventListener("submit", async (e) => {
    e.preventDefault();
    const school = $("#in-school").value.replace(/\s+/g, "");
    const sid = $("#in-sid").value.trim();
    const name = $("#in-name").value.trim();
    const err = $("#err-student");
    err.textContent = "";
    if (school.length < 2) return (err.textContent = ERR.BAD_SCHOOL), $("#in-school").focus();
    if (!/^\d{5}$/.test(sid)) return (err.textContent = ERR.BAD_STUDENT_ID), $("#in-sid").focus();
    if (!name) return (err.textContent = ERR.BAD_NAME), $("#in-name").focus();
    const btn = e.submitter || $("#form-student button");
    btn.disabled = true;
    try {
      const data = await rpc("student_enter", { p_school: school, p_student_id: sid, p_name: name });
      store.set(LS_STUDENT, data.token);
      try {
        localStorage.setItem("emg.school", school);
      } catch (e2) {}
      $("#in-name").value = "";
      startStudent(data);
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#form-teacher").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("#in-pw").value;
    const err = $("#err-teacher");
    err.textContent = "";
    if (!pw) return (err.textContent = "비밀번호를 입력해 주세요."), $("#in-pw").focus();
    const btn = e.submitter || $("#form-teacher button");
    btn.disabled = true;
    try {
      const token = await rpc("teacher_login", { p_password: pw });
      $("#in-pw").value = "";
      store.set(LS_TEACHER, token);
      startTeacher(token);
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------------------------------------------------------- 학생 화면
  const S = {
    token: null,
    sid: "",
    name: "",
    content: null,
    images: [],
    updatedAt: null,
    dirty: false,
    saving: false,
    closed: false,
    status: null,
    editors: {},
    timers: [],
  };
  let saveTimer = null;

  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  function setPath(obj, path, v) {
    const ks = path.split(".");
    const last = ks.pop();
    const tgt = ks.reduce((o, k) => o[k], obj);
    tgt[last] = v;
  }

  function buildTerms() {
    const wrap = $("#terms");
    wrap.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const term = document.createElement("div");
      term.className = "term";
      term.innerHTML = `
        <div class="term-head">
          <span class="term-no">용어 ${"①②③"[i]}</span>
          <input class="term-name" data-term="${i}" data-key="name" maxlength="40" placeholder="용어 이름 (예: 수요함수)" aria-label="용어 ${i + 1} 이름" />        </div>`;
      Sheet.TERM_ROWS.forEach((r) => {
        const row = document.createElement("div");
        row.className = "term-row" + (r.key === "apply" ? " apply" : "");
        row.innerHTML = `<div class="term-label"><div>${r.label}<small>${r.hint}</small></div></div><div class="term-field"><div class="rte-slot" data-field="terms.${i}.${r.key}"></div></div>`;
        row.querySelector(".rte-slot").dataset.placeholder = r.ph;
        term.append(row);
      });
      wrap.append(term);
    }
  }

  function startStudent(data) {
    stopStudentTimers();
    S.token = store.get(LS_STUDENT);
    S.sid = data.student_id;
    S.name = data.name;
    S.content = Sheet.normalize(data.content);
    S.images = data.images || [];
    S.updatedAt = data.updated_at;
    S.dirty = false;
    S.closed = false;
    buildTerms();
    S.school = data.school || "";
    $("#st-who").textContent = `${S.school ? S.school + " " : ""}${S.sid} ${S.name}`;
    $("#sheet-who").textContent = `${S.school ? "학교 " + S.school + "   " : ""}학번 ${S.sid}   이름 ${S.name}`;

    S.editors = {};
    $$("#view-student .rte-slot").forEach((slot) => {
      const field = slot.dataset.field;
      const ed = new Ed.RichEditor(slot, {
        placeholder: slot.dataset.placeholder,
        label: field,
        onChange: () => {
          setPath(S.content, field, ed.getHTML());
          markDirty();
        },
      });
      ed.setHTML(getPath(S.content, field));
      S.editors[field] = ed;
    });
    $$("#terms input").forEach((inp) => {
      inp.value = S.content.terms[+inp.dataset.term][inp.dataset.key] || "";
      inp.addEventListener("input", () => {
        S.content.terms[+inp.dataset.term][inp.dataset.key] = inp.value;
        markDirty();
      });
    });
    $$(".selfcheck input").forEach((cb) => {
      cb.checked = !!S.content.thinking.checks[cb.dataset.check];
      cb.onchange = () => {
        S.content.thinking.checks[cb.dataset.check] = cb.checked;
        markDirty();
      };
    });
    paintMethod();
    paintPhotos();
    paintSave();
    show("student");
    const exit = document.createElement("span");
    $("#topbar-right").replaceChildren(exit);

    S.timers.push(setInterval(tickStudent, 1000));
    S.timers.push(setInterval(refreshStudentStatus, 15000));
    S.timers.push(setInterval(() => S.dirty && saveNow(), 30000));
    refreshStudentStatus();
  }

  function stopStudentTimers() {
    S.timers.forEach(clearInterval);
    S.timers = [];
    clearTimeout(saveTimer);
  }

  $$(".method-tab").forEach((b) =>
    b.addEventListener("click", () => {
      if (S.closed) return;
      S.content.thinking.method = b.dataset.method;
      paintMethod();
      markDirty();
    })
  );
  function paintMethod() {
    const m = S.content.thinking.method;
    $$(".method-tab").forEach((b) => {
      b.setAttribute("aria-checked", String(b.dataset.method === m));
      b.disabled = S.closed;
    });
    $("#method-cartoon").hidden = m !== "cartoon";
    $("#method-writing").hidden = m !== "writing";
    $("#method-empty").hidden = !!m;
  }

  function paintPhotos() {
    const grid = $("#photo-grid");
    grid.replaceChildren();
    S.images.forEach((im, i) => {
      const box = document.createElement("div");
      box.className = "photo";
      const img = document.createElement("img");
      img.src = im.data;
      img.alt = `네컷만화 사진 ${i + 1}`;
      const num = document.createElement("span");
      num.className = "photo-num";
      num.textContent = i + 1;
      box.append(img, num);
      if (!S.closed) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "photo-del";
        del.textContent = "✕";
        del.setAttribute("aria-label", `사진 ${i + 1} 지우기`);
        del.addEventListener("click", () => deletePhoto(im.id));
        box.append(del);
      }
      grid.append(box);
    });
    $("#upload-label").classList.toggle("disabled", S.closed || S.images.length >= 4);
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const max = 1500;
        let { width: w, height: h } = img;
        const k = Math.min(1, max / Math.max(w, h));
        w = Math.round(w * k);
        h = Math.round(h * k);
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let q = 0.82;
        let data = cv.toDataURL("image/jpeg", q);
        while (data.length > 1400000 && q > 0.4) {
          q -= 0.12;
          data = cv.toDataURL("image/jpeg", q);
        }
        resolve(data);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("사진 파일을 읽지 못했어요. JPG·PNG 사진을 골라 주세요."));
      };
      img.src = url;
    });
  }

  $("#in-photo").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (S.images.length >= 4) return toast(ERR.TOO_MANY_IMAGES, true);
    const label = $("#upload-label span");
    label.textContent = "올리는 중…";
    try {
      const data = await compressImage(file);
      const r = await rpc("student_add_image", { p_token: S.token, p_data: data });
      S.images.push({ id: r.id, data });
      S.updatedAt = r.updated_at;
      paintPhotos();
      paintSave();
      toast("사진을 올렸어요.");
    } catch (ex) {
      handleStudentError(ex);
    } finally {
      label.textContent = "＋ 사진 올리기";
    }
  });

  async function deletePhoto(id) {
    if (!confirm("이 사진을 지울까요?")) return;
    try {
      const r = await rpc("student_delete_image", { p_token: S.token, p_image: id });
      S.images = S.images.filter((x) => x.id !== id);
      S.updatedAt = r.updated_at;
      paintPhotos();
      paintSave();
    } catch (ex) {
      handleStudentError(ex);
    }
  }

  function markDirty() {
    if (S.closed) return;
    S.dirty = true;
    paintSave();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 2000);
  }

  let pendingSave = null;
  async function saveNow() {
    clearTimeout(saveTimer);
    if (!S.dirty || S.closed || !S.token) return;
    if (pendingSave) return pendingSave;
    S.saving = true;
    S.dirty = false;
    paintSave();
    const snapshot = JSON.parse(JSON.stringify(S.content));
    pendingSave = rpc("student_save", { p_token: S.token, p_content: snapshot })
      .then((r) => {
        S.updatedAt = r.updated_at;
        S.lastError = null;
      })
      .catch((ex) => {
        S.dirty = true;
        handleStudentError(ex);
        if (ex.code === "NETWORK") {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(saveNow, 5000);
        }
      })
      .finally(() => {
        S.saving = false;
        pendingSave = null;
        paintSave();
        if (S.dirty && !S.closed && !S.lastError) {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(saveNow, 2000);
        }
      });
    return pendingSave;
  }

  function handleStudentError(ex) {
    S.lastError = ex.code || "UNKNOWN";
    if (ex.code === "CLOSED") {
      setClosed(true);
    } else if (ex.code === "SESSION_EXPIRED") {
      setClosed(true, ex.message);
    } else {
      toast(ex.message, true);
    }
    paintSave();
  }

  function paintSave() {
    const el = $("#st-save");
    el.className = "save-state";
    if (S.lastError && S.lastError !== "NETWORK" && S.dirty) {
      el.classList.add("error");
      el.textContent = "저장 안 됨";
    } else if (S.saving) {
      el.classList.add("saving");
      el.textContent = "저장 중…";
    } else if (S.dirty) {
      el.classList.add(S.lastError === "NETWORK" ? "error" : "dirty");
      el.textContent = S.lastError === "NETWORK" ? "연결 끊김 · 다시 시도 중" : "입력 중";
    } else {
      el.textContent = "저장됨";
    }
    $("#st-last").innerHTML = S.updatedAt ? `마지막 수정 <b>${fmtShort(S.updatedAt)}:${pad(new Date(S.updatedAt).getSeconds())}</b>` : "아직 저장한 내용 없음";
  }

  function setClosed(closed, msg) {
    S.closed = closed;
    const banner = $("#st-closed");
    banner.hidden = !closed;
    if (closed) banner.textContent = msg || "마감 시간이 지나 더 이상 저장되지 않습니다. 작성한 내용은 마지막 저장 시점까지 보관됩니다.";
    Object.values(S.editors).forEach((ed) => ed.setReadOnly(closed));
    $$("#terms input, .selfcheck input").forEach((i) => (i.disabled = closed));
    paintMethod();
    paintPhotos();
    if (closed) clearTimeout(saveTimer);
  }

  function tickStudent() {
    const st = S.status;
    const el = $("#st-deadline");
    if (!st || !st.close_at) return (el.textContent = "");
    const left = new Date(st.close_at).getTime() - serverNow();
    if (left <= 0) {
      el.innerHTML = "<b>마감됨</b>";
      if (!S.closed && S.lastError !== "SESSION_EXPIRED") {
        // 마감 직전 입력분을 한 번 더 보내 보고 닫는다(서버가 시간 검사)
        saveNow().finally(() => setClosed(true));
      }
    } else {
      el.innerHTML = `마감 <b>${fmtShort(st.close_at)}</b> · ${fmtLeft(left)} 남음`;
      if (left < 5 * 60 * 1000) el.innerHTML += " ⏰";
    }
  }

  async function refreshStudentStatus() {
    try {
      S.status = absorbStatus(await rpc("app_status"));
      const open = isOpenLocal(S.status);
      if (!open && !S.closed) {
        await saveNow();
        setClosed(true);
      } else if (open && S.closed && S.lastError !== "SESSION_EXPIRED") {
        setClosed(false);
        S.lastError = null;
        toast("접속 시간이 늘어나 다시 작성할 수 있어요.");
      }
      tickStudent();
    } catch (ex) {}
  }

  $("#btn-student-exit").addEventListener("click", async () => {
    if (S.dirty && !S.closed) await saveNow();
    if (S.dirty && !S.closed && !confirm("아직 저장되지 않은 내용이 있어요. 그래도 나갈까요?")) return;
    stopStudentTimers();
    store.del(LS_STUDENT);
    S.token = null;
    showEntry();
  });

  window.addEventListener("beforeunload", (e) => {
    if (S.token && S.dirty && !S.closed && !$("#view-student").hidden) {
      saveNow();
      e.preventDefault();
      e.returnValue = "";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && S.token && S.dirty) saveNow();
  });

  // ---------------------------------------------------------------- 교사 화면
  const T = { token: null, students: [], status: null, timer: null, tick: null, viewing: null };

  async function startTeacher(token) {
    T.token = token;
    show("teacher");
    $("#topbar-right").replaceChildren();
    await loadTeacher(true);
    clearInterval(T.timer);
    clearInterval(T.tick);
    T.timer = setInterval(() => !$("#view-teacher").hidden && loadTeacher(false), 30000);
    T.tick = setInterval(() => !$("#view-teacher").hidden && paintTiles(), 1000);
  }

  function teacherFail(ex) {
    if (ex.code === "TEACHER_AUTH") {
      store.del(LS_TEACHER);
      clearInterval(T.timer);
      clearInterval(T.tick);
      showEntry();
      $("#err-teacher").textContent = ex.message;
      return true;
    }
    toast(ex.message, true);
    return false;
  }

  async function loadTeacher(fillForm) {
    try {
      const d = await rpc("teacher_list", { p_token: T.token });
      T.status = absorbStatus(d.status);
      T.students = d.students || [];
      if (fillForm) fillWindowForm();
      paintTeacher();
      const now = new Date();
      $("#t-refreshed").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}에 불러옴 · 30초마다 자동 새로고침`;
    } catch (ex) {
      teacherFail(ex);
    }
  }

  const toLocalInput = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  function fillWindowForm() {
    $("#in-open").value = toLocalInput(T.status && T.status.open_at);
    $("#in-close").value = toLocalInput(T.status && T.status.close_at);
  }

  async function saveWindow(openDate, closeDate) {
    const err = $("#err-window");
    err.textContent = "";
    if (!(openDate instanceof Date) || isNaN(openDate) || !(closeDate instanceof Date) || isNaN(closeDate))
      return (err.textContent = "시작과 마감 시각을 모두 골라 주세요.");
    if (closeDate <= openDate) return (err.textContent = ERR.BAD_WINDOW);
    try {
      T.status = absorbStatus(
        await rpc("teacher_set_window", { p_token: T.token, p_open: openDate.toISOString(), p_close: closeDate.toISOString() })
      );
      fillWindowForm();
      paintTiles();
      toast("접속 시간을 저장했어요.");
    } catch (ex) {
      if (!teacherFail(ex)) err.textContent = ex.message;
    }
  }
  $("#form-window").addEventListener("submit", (e) => {
    e.preventDefault();
    saveWindow(new Date($("#in-open").value), new Date($("#in-close").value));
  });
  $("#btn-now50").addEventListener("click", () => {
    const o = new Date(serverNow());
    o.setSeconds(0, 0);
    saveWindow(o, new Date(o.getTime() + 50 * 60000));
  });
  $("#btn-close-now").addEventListener("click", () => {
    if (!confirm("지금 바로 마감할까요? 작성 중인 학생도 더 이상 저장할 수 없어요.")) return;
    const now = new Date(serverNow());
    const open = T.status && T.status.open_at && new Date(T.status.open_at) < now ? new Date(T.status.open_at) : new Date(now.getTime() - 60000);
    saveWindow(open, now);
  });

  function paintTiles() {
    const st = T.status;
    const open = isOpenLocal(st);
    const v = $("#tile-open");
    v.textContent = open ? "열림" : "닫힘";
    v.className = "tile-value " + (open ? "open" : "closed");
    const w = windowText(st);
    $("#tile-open-sub").textContent = w.text;
  }

  function classOf(sid) {
    return `${sid[0]}학년 ${+sid.slice(1, 3)}반`;
  }
  // 반 고르기 값: "학교|학번앞3자리"
  const classKey = (s) => `${s.school || ""}|${s.student_id.slice(0, 3)}`;
  function classLabel(key) {
    const [school, pre] = key.split("|");
    return `${school || "(학교 없음)"} ${classOf(pre)}`;
  }

  function paintTeacher() {
    paintTiles();
    const list = T.students;
    const now = serverNow();
    $("#tile-count").textContent = list.length;
    $("#tile-active").textContent = list.filter((s) => s.updated_at && now - new Date(s.updated_at).getTime() < 10 * 60000).length;
    $("#tile-done").textContent = list.filter((s) => Sheet.progress(s.content, s.image_count).complete).length;

    const sel = $("#sel-class");
    const cur = sel.value;
    const classes = [...new Set(list.map(classKey))].sort();
    sel.replaceChildren(new Option("전체", ""), ...classes.map((c) => new Option(classLabel(c), c)));
    sel.value = classes.includes(cur) ? cur : "";
    paintRows();
  }

  function visibleStudents() {
    const c = $("#sel-class").value;
    const q = $("#in-search").value.trim();
    return T.students.filter(
      (s) => (!c || classKey(s) === c) && (!q || s.student_id.includes(q) || s.name.includes(q) || (s.school || "").includes(q))
    );
  }

  function paintRows() {
    const rows = visibleStudents();
    const tb = $("#t-rows");
    tb.replaceChildren();
    $("#t-empty").hidden = T.students.length > 0;
    rows.forEach((s) => {
      const p = Sheet.progress(s.content, s.image_count);
      const tr = document.createElement("tr");
      const dots = (n, named) =>
        `<span class="dots" title="${n}/3 칸 작성${named ? "" : " · 용어 이름 없음"}">${[0, 1, 2].map((i) => `<span class="dot${i < n ? " on" : ""}"></span>`).join("")}</span>`;
      const method =
        p.method === "cartoon"
          ? `<span class="badge cartoon">네컷${s.image_count ? " " + s.image_count + "장" : ""}</span>`
          : p.method === "writing"
          ? '<span class="badge writing">줄글</span>'
          : '<span class="badge">-</span>';
      tr.innerHTML = `<td></td><td>${s.student_id}</td><td></td><td>${method} ${p.thinking ? "✓" : ""}</td>
        <td>${dots(p.terms[0], p.named[0])}</td><td>${dots(p.terms[1], p.named[1])}</td><td>${dots(p.terms[2], p.named[2])}</td>
        <td>${s.updated_at ? Sheet.fmt(s.updated_at) : '<span class="muted">저장 전</span>'}</td>
        <td><div class="row-actions"><button class="btn btn-ghost btn-small" data-act="view">보기</button><button class="btn btn-primary btn-small" data-act="pdf">PDF</button></div></td>`;
      tr.children[0].textContent = s.school || "-";
      tr.children[2].textContent = s.name;
      tr.querySelector('[data-act="view"]').addEventListener("click", () => openView(s));
      tr.querySelector('[data-act="pdf"]').addEventListener("click", (e) => downloadOne(s, e.currentTarget));
      tb.append(tr);
    });
    if (T.students.length && !rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="9" class="empty">조건에 맞는 학생이 없어요.</td>';
      tb.append(tr);
    }
  }
  $("#sel-class").addEventListener("change", paintRows);
  $("#in-search").addEventListener("input", paintRows);
  $("#btn-t-refresh").addEventListener("click", () => loadTeacher(false));
  $("#btn-t-logout").addEventListener("click", async () => {
    try {
      await rpc("teacher_logout", { p_token: T.token });
    } catch (e) {}
    store.del(LS_TEACHER);
    clearInterval(T.timer);
    clearInterval(T.tick);
    T.token = null;
    showEntry();
  });

  async function imagesFor(s) {
    if (!s.image_count) return [];
    return rpc("teacher_get_images", { p_token: T.token, p_id: s.id });
  }

  async function openView(s) {
    T.viewing = s;
    const body = $("#view-body");
    body.innerHTML = '<p class="muted">불러오는 중…</p>';
    $("#dlg-view-title").textContent = `${s.school ? s.school + " " : ""}${s.student_id} ${s.name}`;
    $("#dlg-view").showModal();
    try {
      const imgs = await imagesFor(s);
      body.replaceChildren(Sheet.renderPaper(s, imgs));
    } catch (ex) {
      body.textContent = ex.message;
      teacherFail(ex);
    }
  }
  $("#btn-view-close").addEventListener("click", () => $("#dlg-view").close());
  $("#btn-view-pdf").addEventListener("click", (e) => T.viewing && downloadOne(T.viewing, e.currentTarget));
  $("#btn-view-delete").addEventListener("click", async () => {
    const s = T.viewing;
    if (!s) return;
    const typed = prompt(`${s.school ? s.school + " " : ""}${s.student_id} ${s.name} 학생의 답안과 사진을 완전히 지웁니다. 되돌릴 수 없어요.\n지우려면 학번(${s.student_id})을 입력하세요.`);
    if (typed !== s.student_id) return;
    try {
      await rpc("teacher_delete_student", { p_token: T.token, p_id: s.id });
      $("#dlg-view").close();
      toast("기록을 지웠어요.");
      loadTeacher(false);
    } catch (ex) {
      teacherFail(ex);
    }
  });

  // ---------------------------------------------------------------- PDF (브라우저 인쇄 → PDF로 저장)
  // 글자·수식이 벡터로 들어가 깔끔하다. 여러 명이면 한 파일에 학생마다 새 쪽으로 이어 붙인다.
  const safeName = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
  const abs = (p) => new URL(p, location.href).href;

  async function printPapers(list, title, onProgress) {
    const papers = [];
    for (let i = 0; i < list.length; i++) {
      if (onProgress) onProgress(i, list.length);
      const imgs = await imagesFor(list[i]);
      papers.push(Sheet.renderPaper(list[i], imgs).outerHTML);
    }
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => `<link rel="stylesheet" href="${abs(l.getAttribute("href"))}">`).join("");
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title.replace(/</g, "")}</title>${links}
      <style>
        @page { size: A4; margin: 10mm; }
        html, body { background: #fff; margin: 0; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .paper { width: auto; margin: 0; padding: 0; box-shadow: none; }
        .paper + .paper { break-before: page; page-break-before: always; }
        .paper-row, .paper-photos img, .paper-score, .paper-term-head, .paper-title { break-inside: avoid; page-break-inside: avoid; }
        .paper-term-head { break-after: avoid; page-break-after: avoid; }
      </style></head><body>${papers.join("")}</body></html>`;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.append(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();
    await new Promise((r) => (frame.contentWindow.document.readyState === "complete" ? r() : frame.addEventListener("load", r, { once: true })));
    await Promise.all([...doc.images].map((im) => (im.complete ? 0 : new Promise((r) => (im.onload = im.onerror = r)))));
    try {
      await doc.fonts.ready;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 300));
    const oldTitle = document.title;
    document.title = title;
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => {
      document.title = oldTitle;
      frame.remove();
    }, 1500);
  }

  async function downloadOne(s, btn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "준비 중…";
    try {
      await printPapers([s], `${s.school ? safeName(s.school) + "_" : ""}${s.student_id}_${safeName(s.name)}_경제수학용어사전`);
      toast("인쇄 창에서 대상을 'PDF로 저장'으로 고르세요.");
    } catch (ex) {
      if (!teacherFail(ex)) toast("PDF를 만들지 못했어요: " + ex.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  $("#btn-zip").addEventListener("click", async (e) => {
    const list = visibleStudents();
    if (!list.length) return toast("받을 학생이 없어요.", true);
    const btn = e.currentTarget;
    const prog = $("#zip-progress");
    btn.disabled = true;
    prog.hidden = false;
    try {
      const c = $("#sel-class").value;
      const title = `경제수학용어사전_${c ? classLabel(c).replace(/\s/g, "") : "전체"}_${list.length}명`;
      await printPapers(list, title, (i, n) => (prog.textContent = `답안 모으는 중… ${i + 1} / ${n}`));
      toast("인쇄 창에서 대상을 'PDF로 저장'으로 고르세요. 학생마다 새 쪽에서 시작해요.");
    } catch (ex) {
      if (!teacherFail(ex)) toast("PDF를 만들지 못했어요: " + ex.message, true);
    } finally {
      btn.disabled = false;
      prog.hidden = true;
    }
  });

  // ---------------------------------------------------------------- 시작
  async function boot() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) return fatal("config.js 에 Supabase 연결 정보가 없어요.");
    if (/^sb_secret_/.test(cfg.SUPABASE_KEY)) return fatal("config.js 에 비밀 키가 들어 있어요. 공개용 키로 바꿔 주세요.");
    if (!window.supabase || !window.DOMPurify || !window.MathLive)
      return fatal("필요한 도구를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    try {
      window.MathLive.MathfieldElement.fontsDirectory = "https://cdn.jsdelivr.net/npm/mathlive@0.98.6/dist/fonts";
      window.MathLive.MathfieldElement.soundsDirectory = null;
    } catch (e) {}

    const tt = store.get(LS_TEACHER);
    if (tt) {
      T.token = tt;
      try {
        await rpc("teacher_list", { p_token: tt });
        return startTeacher(tt);
      } catch (e) {
        store.del(LS_TEACHER);
      }
    }
    const st = store.get(LS_STUDENT);
    if (st) {
      try {
        const d = await rpc("student_load", { p_token: st });
        S.token = st;
        startStudent(d);
        return;
      } catch (e) {
        store.del(LS_STUDENT);
      }
    }
    showEntry();
  }
  boot();
})();
