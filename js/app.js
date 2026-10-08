/* 교복 학교주관구매 길라잡이 — 연습판 (빌드 없는 정적 SPA)
 * 데이터: data/data.js (window.APP_DATA, 원본 _workspace/05_web/data/*.json에서 변환)
 * 저장: sessionStorage(탭을 닫으면 사라짐) — 서버·DB 미사용 원칙(0-2.md §1-4)
 */
(function () {
  "use strict";

  const D = window.APP_DATA;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const fieldById = Object.fromEntries(D.fields.map((f) => [f.fieldId, f]));
  const formById = Object.fromEntries(D.forms.map((f) => [f.formId, f]));
  const methodById = Object.fromEntries(D.contractMethods.map((m) => [m.id, m]));
  const workflowById = Object.fromEntries(D.workflows.map((w) => [w.workflowId, w]));

  const TABS = [
    { key: "common", label: "공통", group: "공통" },
    { key: "biz", label: "사업", group: "사업" },
    { key: "doc", label: "문서별", group: "문서별" },
    { key: "item", label: "품목", repeat: "품목" },
    { key: "company", label: "업체", repeat: "업체" },
    { key: "member", label: "위원", repeat: "위원" },
    { key: "eval", label: "평가", repeat: "평가" },
  ];
  const MAX_ROWS = 10; // Excel 기초자료입력 반복행 10행과 동일
  const STAGES = ["준비", "입찰", "평가", "계약", "구매", "사후평가"];
  const OUTPUT_LABEL = { both: "PDF+HWPX", hwpx: "HWPX만", pdf: "PDF만", none: "출력 없음(미구현)" };
  const NAV = [
    ["home", "홈"], ["methods", "계약방법 안내"], ["procedure", "계약절차"], ["input", "기초자료"],
    ["forms", "서식함"], ["export", "내보내기"], ["guide", "사용안내"],
  ];

  /* ---------- 상태 (세션 저장) ---------- */
  const STORE_KEY = "uniform-guide-practice";
  const emptyState = () => ({ values: {}, rows: { 품목: [], 업체: [], 위원: [], 평가: [] }, method: "CM-01", checks: {} });
  let state = load();
  function load() {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE_KEY));
      if (s && s.values && s.rows) return Object.assign(emptyState(), s);
    } catch (e) { /* 저장소 사용 불가 시 빈 상태 */ }
    return emptyState();
  }
  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
  }

  /* ---------- 입력 상태 판정 ---------- */
  const isComputed = (fid) => fieldById[fid] && fieldById[fid].required === "computed";
  const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== "";
  function fieldFilled(fid) {
    const f = fieldById[fid];
    if (!f) return false;
    if (isComputed(fid)) return true;
    if (f.repeatGroup) return (state.rows[f.repeatGroup] || []).some((r) => hasValue(r[fid]));
    return hasValue(state.values[fid]);
  }
  function readiness(form) {
    if (form.implementationStatus === "notImplemented") return { code: "off", label: "○ 미구현", missing: [] };
    const missing = form.requiredFieldIds.filter((fid) => !isComputed(fid) && !fieldFilled(fid));
    return missing.length
      ? { code: "need", label: "▲ 기초자료 필요", missing }
      : { code: "ok", label: "● 작성가능", missing };
  }
  const statusBadge = (r) => `<span class="status ${r.code}">${esc(r.label)}</span>`;
  function tabOfField(fid) {
    const f = fieldById[fid];
    if (!f) return "common";
    const t = TABS.find((t) => (f.repeatGroup ? t.repeat === f.repeatGroup : t.group === f.group));
    return t ? t.key : "common";
  }
  const inputFields = () => D.fields.filter((f) => !isComputed(f.fieldId));
  function progress() {
    const all = inputFields();
    return { done: all.filter((f) => fieldFilled(f.fieldId)).length, total: all.length };
  }
  function money(n) { return Number.isFinite(n) ? n.toLocaleString("ko-KR") + "원" : ""; }
  function num(v) { const n = Number(String(v ?? "").replace(/,/g, "")); return hasValue(v) && Number.isFinite(n) ? n : null; }
  function itemAmount(r) { const q = num(r["R-05"]), p = num(r["R-06"]); return q !== null && p !== null ? q * p : null; }
  function itemTotal() { return state.rows.품목.reduce((s, r) => s + (itemAmount(r) || 0), 0); }
  function evalTotal() { return state.rows.평가.reduce((s, r) => s + (num(r["R-07"]) || 0), 0); }
  function fmtDate(v) {
    if (!hasValue(v)) return "";
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return String(v);
    return `${m[1]}. ${+m[2]}. ${+m[3]}.` + (m[4] ? ` ${m[4]}:${m[5]}` : "");
  }
  function displayValue(fid) {
    const f = fieldById[fid];
    const v = state.values[fid];
    if (!hasValue(v)) return "";
    if (f.type === "date" || f.type === "datetime") return fmtDate(v);
    if (f.type === "currency") return money(num(v));
    if (f.type === "stringArray") return String(v).split("\n").filter(hasValue).map((x, i) => `${i + 1}. ${x}`).join(" / ");
    return String(v);
  }

  /* ---------- 검증 (입력칸 인접 오류 안내) ---------- */
  function validate(fid, raw) {
    const f = fieldById[fid];
    if (!f || !hasValue(raw)) return "";
    const v = String(raw).trim();
    const len = (f.validation || "").match(/(\d+)~(\d+)자/);
    if (len && (f.type === "string" || f.type === "text") && (v.length < +len[1] || v.length > +len[2])) return `${len[1]}~${len[2]}자로 입력하세요.`;
    if (f.type === "text" && v.length > 2000) return "2,000자 이하로 입력하세요.";
    if (f.type === "year" && !/^\d{4}$/.test(v)) return "4자리 연도로 입력하세요.";
    if (f.type === "year" && (+v < 2000 || +v > 2100)) return "2000~2100 사이 연도만 허용됩니다.";
    if ((f.type === "currency" || f.type === "integer") && !/^\d+$/.test(v)) return "0 이상의 정수만 입력하세요(쉼표·통화기호 없이).";
    if (f.type === "number" && !(Number(v) >= 0)) return "0 이상의 숫자를 입력하세요.";
    if (fid === "R-09" && !/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(v)) return "전화번호 형식(예: 063-123-4567)으로 입력하세요.";
    if (fid === "B-07" && hasValue(state.values["C-05"]) && v.slice(0, 10) < state.values["C-05"]) return "제출기한은 문서 발행일 이후여야 합니다.";
    return "";
  }
  function enumOptions(fid) {
    if (fid === "B-03") return D.contractMethods.map((m) => m.label);
    const f = fieldById[fid];
    return [...(f.validation || "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  }

  /* ---------- 공통 레이아웃 ---------- */
  function renderChrome(route) {
    $("#navList").innerHTML = NAV.map(([k, label]) =>
      `<li><a href="#/${k}"${route === k ? ' aria-current="page"' : ""}>${label}</a></li>`).join("");
    updateBadge();
  }
  function updateBadge() {
    const p = progress();
    $("#progressBadge").textContent = `기초자료 ${p.done}/${p.total}`;
  }
  function breadcrumb(items) {
    $("#breadcrumb").innerHTML = [`<a href="#/home">홈</a>`]
      .concat(items.map((it, i) => i === items.length - 1
        ? `<span aria-current="page">${esc(it[0])}</span>`
        : `<a href="${it[1]}">${esc(it[0])}</a>`))
      .join(" › ");
  }
  function setMethodColor(color) { document.documentElement.style.setProperty("--method", color || "var(--navy)"); }

  /* ---------- 1. 홈 ---------- */
  function viewHome() {
    breadcrumb([]);
    const ready = D.forms.filter((f) => readiness(f).code === "ok").length;
    const p = progress();
    return `
      <p class="eyebrow">SCHOOL UNIFORM PROCUREMENT GUIDE</p>
      <h1>교복 학교주관구매 길라잡이</h1>
      <p class="lead">계약방법 안내부터 서식 작성·출력까지 한 곳에서</p>
      <div class="banner cta">
        <div><strong>한눈에 보는 계약 업무 길잡이</strong>계약 방식 선택 → 기초자료 입력·저장 → 서식 작성·출력 · 3분 시작 안내</div>
        <a class="btn" href="#/guide">GO →</a>
      </div>
      <h2>계약 방식을 선택해 주세요</h2>
      <p class="lead">계약방법은 시스템이 자동 판정하지 않습니다. 조건을 확인하고 담당자가 직접 선택합니다.</p>
      <div class="method-grid">
        ${D.contractMethods.map((m, i) => `
          <article class="card method-card" style="--method:${m.color}">
            <span class="step-label">STEP ${i + 1} · ${m.stepCount}단계</span>
            <h3>${esc(m.label)}</h3>
            <p>${esc(m.note)}</p>
            <span class="meta">공통 필수서식 ${m.commonForms ? m.commonForms.length + "종" : esc(m.commonFormsRaw)} · 절차 관련서식 ${m.workflowFormIds.length}종</span>
            <a class="go" href="#/procedure/${m.id}/1">절차 확인 →</a>
          </article>`).join("")}
      </div>
      <div class="card" style="margin-top:20px">
        <h3>지금 내 작업 현황</h3>
        <div class="stat-row">
          <span class="status ${p.done ? "ok" : "off"}">기초자료 ${p.done}/${p.total} 입력</span>
          <span class="status ok">● 작성가능 서식 ${ready}종</span>
          <span class="status need">▲ 기초자료 필요 ${D.forms.filter((f) => readiness(f).code === "need").length}종</span>
        </div>
        <div class="btn-row"><a class="btn secondary" href="#/input/common">기초자료 입력으로</a><a class="btn secondary" href="#/forms">서식함으로</a></div>
      </div>`;
  }

  /* ---------- 2. 계약방법 안내 ---------- */
  function viewMethods() {
    breadcrumb([["계약방법 안내"]]);
    const ms = D.contractMethods;
    const row = (label, fn) => `<tr><th scope="row">${label}</th>${ms.map((m) => `<td>${fn(m)}</td>`).join("")}</tr>`;
    const formList = (ids) => ids.length ? ids.map((id) => `${id} ${esc(formById[id] ? formById[id].title : "")}`).join("<br>") : "—";
    return `
      <h1>계약방법 안내</h1>
      <p class="lead">4가지 계약방법의 적용조건·절차·필요서식을 나란히 비교합니다.</p>
      <div class="banner info">계약방법은 행정실 담당자가 근거 법령과 추정금액을 검토하여 최종 결정합니다. 이 화면의 적용조건은 <strong>참고용</strong>이며 자동 판정이 아닙니다.</div>
      <div class="table-wrap">
        <table class="compare">
          <thead><tr><th scope="col">구분</th>${ms.map((m) => `<th scope="col" style="border-top:4px solid ${m.color};color:var(--text)">${esc(m.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${row("적용조건(참고)", (m) => esc(m.note))}
            ${row("확인할 점", (m) => esc(m.guide))}
            ${row("단계 수", (m) => `${m.stepCount}단계`)}
            ${row("주요 절차", (m) => `<ol>${workflowById[m.workflowId].steps.map((s) => `<li>${esc(s.stepName)}</li>`).join("")}</ol>`)}
            ${row("공통 필수서식", (m) => m.commonForms ? formList(m.commonForms) : esc(m.commonFormsRaw))}
            ${row("절차 관련서식", (m) => `${m.workflowFormIds.length}종`)}
            ${row("", (m) => `<a class="btn method" style="--method:${m.color}" href="#/procedure/${m.id}/1">이 방식으로 진행</a>`)}
          </tbody>
        </table>
      </div>
      <p class="lead" style="margin-top:12px;font-size:13px">2단계 계약과 일반입찰계약은 원본 Excel에서 같은 11단계 절차로 연결됩니다. 일반입찰 전용 절차는 매뉴얼 확인이 필요합니다.</p>`;
  }

  /* ---------- 3. 계약절차 ---------- */
  function viewProcedure(methodId, stepNo) {
    const m = methodById[methodId] || methodById[state.method] || D.contractMethods[0];
    if (state.method !== m.id) { state.method = m.id; save(); }
    const wf = workflowById[m.workflowId];
    const step = wf.steps.find((s) => s.stepNo === +stepNo) || wf.steps[0];
    setMethodColor(m.color);
    breadcrumb([["계약절차", "#/procedure"], [m.label]]);
    const checkKey = (s, i) => `${m.id}-${s.stepNo}-${i}`;
    const stepDone = (s) => s.checklist.length > 0 && s.checklist.every((_, i) => state.checks[checkKey(s, i)]);

    const needFields = [...new Set(step.formIds.flatMap((id) => (formById[id] ? formById[id].requiredFieldIds : [])))].filter((fid) => !isComputed(fid));
    const missingCount = needFields.filter((fid) => !fieldFilled(fid)).length;
    const pad = (n) => String(n).padStart(2, "0");
    const prev = wf.steps.find((s) => s.stepNo === step.stepNo - 1);
    const next = wf.steps.find((s) => s.stepNo === step.stepNo + 1);

    return `
      <div class="method-switch" role="group" aria-label="계약방법 전환">
        ${D.contractMethods.map((x) => `<a href="#/procedure/${x.id}/1" style="--method:${x.color}"${x.id === m.id ? ' aria-current="true"' : ""}>${esc(x.label)}</a>`).join("")}
      </div>
      <h1>계약절차 · ${esc(m.label)}</h1>
      <p class="lead">${esc(m.note)}</p>
      <div class="procedure">
        <nav class="card" style="padding:0" aria-label="절차 단계">
          <ol class="stepper">
            ${wf.steps.map((s) => `<li class="${stepDone(s) ? "done" : ""}"><a href="#/procedure/${m.id}/${s.stepNo}"${s.stepNo === step.stepNo ? ' aria-current="step"' : ""}>
              <span class="dot" aria-hidden="true">${stepDone(s) && s.stepNo !== step.stepNo ? "✓" : s.stepNo}</span>
              <span>STEP ${pad(s.stepNo)} · ${esc(s.stepName)}${stepDone(s) ? '<span class="sr-only"> (완료)</span>' : ""}</span></a></li>`).join("")}
          </ol>
        </nav>
        <section class="card" aria-labelledby="stepTitle">
          <div class="step-head">
            <div><span class="step-no">STEP ${pad(step.stepNo)} / ${wf.steps.length}</span><h2 id="stepTitle">${esc(step.stepName)}</h2></div>
            <span class="pill" title="원본 Excel에 담당구분이 없어 업무설명 주어에서 도출 — 매뉴얼 확인 필요">담당구분 · ${esc(step.assignee)}</span>
          </div>
          <p>${esc(step.description)}</p>

          <h3>해야 할 일 ${step.checklist.length}개</h3>
          <ul class="checklist">
            ${step.checklist.map((t, i) => `<li><label><input type="checkbox" data-check="${esc(checkKey(step, i))}"${state.checks[checkKey(step, i)] ? " checked" : ""}> <span>${esc(t)}</span></label></li>`).join("")}
          </ul>

          ${step.cautions.map((c) => `<div class="banner warn" role="note">⚠ ${esc(c.text)}${c.confirm ? " <strong>(매뉴얼 확인 필요)</strong>" : ""}</div>`).join("")}

          <div class="section-title"><h3>필요 기초자료</h3><small>${needFields.length ? `${missingCount}개 미입력` : ""}</small></div>
          ${needFields.length ? `<div class="chips">${needFields.map((fid) => fieldFilled(fid)
            ? `<span class="status ok">${esc(fieldById[fid].label)} ✓</span>`
            : `<a class="status need" href="#/input/${tabOfField(fid)}">${esc(fieldById[fid].label)} ▲</a>`).join("")}</div>`
            : `<p class="empty">이 단계에 연결된 서식이 없어 필요한 기초자료도 없습니다.</p>`}

          <h3>관련 서식 ${step.formIds.length}종</h3>
          ${step.formIds.length ? `<div class="table-wrap"><table>
            <thead><tr><th scope="col">코드</th><th scope="col">서식명</th><th scope="col">상태</th><th scope="col">액션</th></tr></thead>
            <tbody>${step.formIds.map((id) => formRow(formById[id])).join("")}</tbody></table></div>`
            : `<p class="empty">원본 Excel에도 이 단계에 연결된 서식이 없습니다.</p>`}

          <div class="step-nav">
            ${prev ? `<a class="btn secondary" href="#/procedure/${m.id}/${prev.stepNo}">← STEP ${pad(prev.stepNo)}</a>` : "<span></span>"}
            ${next ? `<a class="btn method" href="#/procedure/${m.id}/${next.stepNo}">STEP ${pad(next.stepNo)} →</a>` : `<a class="btn method" href="#/forms">서식함으로 →</a>`}
          </div>
        </section>
      </div>`;
  }
  function formRow(f) {
    if (!f) return "";
    const r = readiness(f);
    const action = r.code === "off" ? `<span class="tag">출력 없음</span>`
      : `<button class="btn ghost" data-preview="${f.formId}">미리보기</button>` +
        (r.code === "need" ? ` · <a href="#/input/${tabOfField(r.missing[0])}">기초자료 입력하기</a>` : "");
    return `<tr><td><strong>${f.formId}</strong></td><td>${esc(f.title)}</td><td>${statusBadge(r)}</td><td>${action}</td></tr>`;
  }

  /* ---------- 4. 기초자료입력 ---------- */
  function viewInput(tabKey) {
    const tab = TABS.find((t) => t.key === tabKey) || TABS[0];
    breadcrumb([["기초자료", "#/input/common"], [tab.label]]);
    return `
      <h1>기초자료 입력</h1>
      <div class="banner info" role="note">🔒 입력한 업무자료는 서버 DB에 저장하지 않습니다. 이 브라우저 탭에만 임시 보관되며 탭을 닫으면 사라집니다. 보관이 필요하면 <a href="#/export">내보내기</a>에서 백업 파일로 저장하세요. 학생 신체 치수, 서명·직인 이미지, 위원 연락처는 입력하지 않습니다.</div>
      <div class="input-layout">
        <nav class="tabs" aria-label="입력 섹션">
          ${TABS.map((t) => `<a href="#/input/${t.key}"${t.key === tab.key ? ' aria-current="page"' : ""}>${t.label} <small data-tab-count="${t.key}">${tabCount(t)}</small></a>`).join("")}
        </nav>
        <section class="card" aria-labelledby="tabTitle">
          <h2 id="tabTitle">${tab.label}${tab.repeat ? " 반복행" : "정보"}</h2>
          ${tab.repeat ? repeatTable(tab.repeat) : scalarForm(tab.group)}
        </section>
        <aside class="card side" id="sidePanel" aria-label="빠른 출력 체크리스트">${sidePanel()}</aside>
      </div>`;
  }
  function tabCount(t) {
    const fs = inputFields().filter((f) => (t.repeat ? f.repeatGroup === t.repeat : f.group === t.group && !f.repeatGroup));
    return `${fs.filter((f) => fieldFilled(f.fieldId)).length}/${fs.length}`;
  }
  function scalarForm(group) {
    const fs = D.fields.filter((f) => f.group === group && !f.repeatGroup);
    return `<div class="form-grid">${fs.map((f) => {
      const id = "in-" + f.fieldId;
      const v = state.values[f.fieldId] ?? "";
      const err = validate(f.fieldId, v);
      const wide = f.type === "text" || f.type === "stringArray" ? " wide" : "";
      let control;
      if (f.type === "enum") {
        control = `<select id="${id}" data-field="${f.fieldId}"><option value="">선택하세요</option>${enumOptions(f.fieldId).map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      } else if (f.type === "text" || f.type === "stringArray") {
        control = `<textarea id="${id}" data-field="${f.fieldId}" aria-describedby="${id}-hint ${id}-err">${esc(v)}</textarea>`;
      } else {
        const type = { date: "date", datetime: "datetime-local", year: "number", integer: "number", currency: "number" }[f.type] || "text";
        const extra = type === "number" ? ' min="0" step="1" inputmode="numeric"' : "";
        control = `<input id="${id}" type="${type}" data-field="${f.fieldId}" value="${esc(v)}"${extra} aria-describedby="${id}-hint ${id}-err"${err ? ' aria-invalid="true"' : ""}>`;
      }
      return `<div class="field${wide}">
        <label for="${id}">${esc(f.label)} <small style="color:var(--muted)">${f.fieldId}</small>${f.required === "required" ? '<span class="req">필수</span>' : ""}</label>
        ${control}
        <span class="hint" id="${id}-hint">${esc(f.validation)}${f.type === "stringArray" ? " · 한 줄에 한 항목" : ""}</span>
        <span class="err" id="${id}-err" role="alert">${esc(err)}</span>
      </div>`;
    }).join("")}</div>`;
  }
  function repeatColumns(group) {
    const g = D.repeatGroups.find((x) => x.group === group);
    const cols = g.fieldIds.map((fid) => ({ key: fid, label: fieldById[fid].label, computed: isComputed(fid) }));
    // 평가 그룹: Excel의 평가항목·배점 열(Field ID 미부여)을 함께 둠 — fields.json repeatGroups 주석
    if (group === "평가") cols.unshift({ key: "item", label: "평가항목" }, { key: "max", label: "배점" });
    return cols;
  }
  function repeatTable(group) {
    const cols = repeatColumns(group);
    const rows = state.rows[group];
    const cell = (r, i, c) => {
      if (c.key === "K-01") return `<td class="num" data-amount="${i}">${money(itemAmount(r))}</td>`;
      if (c.key === "K-03") return "";
      const f = fieldById[c.key];
      const lbl = `${c.label} ${i + 1}행`;
      if (f && f.type === "enum") {
        return `<td><select aria-label="${esc(lbl)}" data-row="${i}" data-group="${group}" data-col="${c.key}"><option value="">선택</option>${enumOptions(c.key).map((o) => `<option${o === r[c.key] ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></td>`;
      }
      const numeric = (f && ["integer", "currency", "number"].includes(f.type)) || c.key === "max";
      return `<td><input aria-label="${esc(lbl)}" ${numeric ? 'type="number" min="0" inputmode="numeric"' : 'type="text"'} data-row="${i}" data-group="${group}" data-col="${c.key}" value="${esc(r[c.key] ?? "")}"></td>`;
    };
    const visible = cols.filter((c) => c.key !== "K-03");
    const total = group === "품목" ? `<tfoot><tr><td colspan="${visible.length - 1}">합계금액(K-02, 자동계산)</td><td class="num" id="itemTotal">${money(itemTotal())}</td><td></td></tr></tfoot>`
      : group === "평가" ? `<tfoot><tr><td colspan="${visible.length - 1}">평가 총점(K-03, 자동계산)</td><td class="num" id="evalTotal">${evalTotal()}점</td><td></td></tr></tfoot>` : "";
    const notes = {
      위원: "위원 성명은 2026-09-23 결정에 따라 실명 반영이 허용됩니다. 위원 연락처·서명은 입력하지 않습니다.",
      업체: "대표자 연락처는 전화번호 텍스트만 입력합니다(서명·직인 그래픽 아님).",
      품목: "금액은 수량 × 단가로 자동 계산됩니다.",
      평가: "점수는 0점 이상, 배점 이하로 입력합니다.",
    };
    return `
      <p class="lead" style="margin-bottom:10px">${notes[group]} 최대 ${MAX_ROWS}행.</p>
      <div class="table-wrap repeat"><table>
        <thead><tr>${visible.map((c) => `<th scope="col">${esc(c.label)}${c.key.match(/^[RK]-/) ? ` <small>${c.key}</small>` : ""}</th>`).join("")}<th scope="col"><span class="sr-only">삭제</span></th></tr></thead>
        <tbody>${rows.length ? rows.map((r, i) => `<tr>${visible.map((c) => cell(r, i, c)).join("")}<td><button class="btn ghost" data-del-row="${i}" data-group="${group}" aria-label="${i + 1}행 삭제">삭제</button></td></tr>`).join("")
          : `<tr><td colspan="${visible.length + 1}" class="empty">아직 입력한 행이 없습니다. 아래 [+ 행 추가]를 누르세요.</td></tr>`}</tbody>
        ${rows.length ? total : ""}
      </table></div>
      <div class="btn-row" style="margin-top:12px"><button class="btn secondary" data-add-row="${group}"${rows.length >= MAX_ROWS ? " disabled" : ""}>+ 행 추가</button>
      <span class="err" id="rowErr" role="alert"></span></div>`;
  }
  function sidePanel() {
    const rs = D.forms.map((f) => ({ f, r: readiness(f) }));
    const count = (c) => rs.filter((x) => x.r.code === c).length;
    const missTally = {};
    rs.forEach((x) => x.r.missing.forEach((fid) => { missTally[fid] = (missTally[fid] || 0) + 1; }));
    const top = Object.entries(missTally).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return `
      <h3>빠른 출력 체크리스트</h3>
      <div class="stat-row">
        <span class="status ok">● ${count("ok")}</span><span class="status need">▲ ${count("need")}</span><span class="status off">○ ${count("off")}</span>
      </div>
      ${top.length ? `<p style="margin:0;font-size:14px"><strong>먼저 채우면 좋은 값</strong> (막혀 있는 서식 수)</p>
        <ul>${top.map(([fid, n]) => `<li><a href="#/input/${tabOfField(fid)}">${esc(fieldById[fid].label)}</a> — ${n}종</li>`).join("")}</ul>`
        : `<p style="font-size:14px">필수값이 모두 채워졌습니다.</p>`}
      <a class="btn secondary" href="#/forms" style="margin-top:8px">서식함에서 확인 →</a>`;
  }

  /* ---------- 5. 서식함 ---------- */
  const formsFilter = { q: "", stage: "전체", method: "", status: "" };
  function viewForms() {
    breadcrumb([["서식함"]]);
    return `
      <h1>서식함</h1>
      <p class="lead">전체 ${D.forms.length}종 서식을 검색·필터하고, 작성 가능 여부를 확인합니다.</p>
      <div class="form-toolbar">
        <label class="sr-only" for="formQ">서식 검색</label>
        <input id="formQ" type="search" placeholder="서식명, F-번호, 매뉴얼 번호" value="${esc(formsFilter.q)}">
        <label class="sr-only" for="formMethod">계약방법</label>
        <select id="formMethod"><option value="">모든 계약방법</option>${D.contractMethods.map((m) => `<option value="${m.id}"${formsFilter.method === m.id ? " selected" : ""}>${esc(m.label)}</option>`).join("")}</select>
        <label class="sr-only" for="formStatus">작성 상태</label>
        <select id="formStatus"><option value="">모든 상태</option><option value="ok"${formsFilter.status === "ok" ? " selected" : ""}>● 작성가능</option><option value="need"${formsFilter.status === "need" ? " selected" : ""}>▲ 기초자료 필요</option><option value="off"${formsFilter.status === "off" ? " selected" : ""}>○ 미구현</option></select>
      </div>
      <div class="filters" role="group" aria-label="업무단계 필터">
        ${["전체", ...STAGES].map((s) => `<button class="chip-btn" data-stage="${s}" aria-pressed="${formsFilter.stage === s}">${s}</button>`).join("")}
      </div>
      <p class="result-count" id="formCount" aria-live="polite"></p>
      <div class="form-grid-cards" id="formCards"></div>`;
  }
  function renderFormCards() {
    const q = formsFilter.q.trim().toLowerCase();
    const list = D.forms.filter((f) => {
      const r = readiness(f);
      if (formsFilter.stage !== "전체" && f.stage !== formsFilter.stage) return false;
      if (formsFilter.method && !f.contractMethods.includes(formsFilter.method)) return false;
      if (formsFilter.status && r.code !== formsFilter.status) return false;
      if (q && !`${f.formId} ${f.title} ${f.manualNo} ${f.docType}`.toLowerCase().includes(q)) return false;
      return true;
    });
    $("#formCount").textContent = `${list.length}종 표시`;
    $("#formCards").innerHTML = list.length ? list.map(formCard).join("") : `<p class="empty">조건에 맞는 서식이 없습니다. 검색어나 필터를 바꿔 보세요.</p>`;
  }
  function formCard(f) {
    const r = readiness(f);
    const methods = f.contractMethods.map((id) => `<span class="tag method" style="background:${methodById[id].color}">${esc(methodById[id].label.replace(/\(.*\)/, ""))}</span>`).join("")
      || `<span class="tag" title="계약절차 어느 단계에도 연결되지 않음 — 매뉴얼 확인 필요">절차 미연결</span>`;
    return `
      <article class="card form-card">
        <div class="fid">${f.formId}<small>매뉴얼 ${esc(f.manualNo)}</small></div>
        <h3>${esc(f.title)}</h3>
        <div>${methods}</div>
        <div><span class="tag">${esc(f.stage)}</span><span class="tag">${esc(f.author)}</span><span class="tag">${esc(OUTPUT_LABEL[f.outputMethod])}</span>${f.privacyProtected ? '<span class="tag privacy">개인정보 보호 · 빈 양식</span>' : ""}</div>
        ${r.code === "need" ? `<details class="missing-box"><summary>${statusBadge(r)} 누락 ${r.missing.length}개</summary>
          <ul>${r.missing.map((fid) => `<li>${esc(fieldById[fid].label)} (${fid})</li>`).join("")}</ul>
          <a class="btn secondary" href="#/input/${tabOfField(r.missing[0])}">기초자료 입력하기</a></details>` : ""}
        <div class="actions">${r.code !== "need" ? statusBadge(r) : "<span></span>"}
          ${r.code === "off" ? "" : `<button class="btn secondary" data-preview="${f.formId}">미리보기</button>`}</div>
      </article>`;
  }

  /* ---------- 6. 문서 미리보기 모달 ---------- */
  let lastFocus = null;
  function openPreview(formId) {
    const f = formById[formId];
    if (!f) return;
    const r = readiness(f);
    const allowed = f.privacyProtected ? new Set(f.privacyAllowedFieldIds || []) : null;
    const blocked = (fid) => allowed && !allowed.has(fid);
    const scalar = f.inputFieldIds.filter((fid) => fieldById[fid] && !fieldById[fid].repeatGroup && !isComputed(fid));
    const groups = [...new Set(f.inputFieldIds.map((fid) => fieldById[fid] && fieldById[fid].repeatGroup).filter(Boolean))];
    const val = (fid) => blocked(fid) ? `<span class="kept">개인정보 보호 — 빈칸 유지</span>`
      : hasValue(state.values[fid]) ? esc(displayValue(fid)) : `<span class="blank">〔미입력: ${esc(fieldById[fid].label)}〕</span>`;
    const groupTable = (g) => {
      if (allowed) return "";
      const cols = repeatColumns(g).filter((c) => c.key !== "K-03" && (c.key === "item" || c.key === "max" || f.inputFieldIds.includes(c.key) || (c.key === "K-01" && f.inputFieldIds.some((x) => x.startsWith("R-0") && fieldById[x].repeatGroup === "품목"))));
      const rows = state.rows[g];
      const body = rows.length ? rows.map((row) => `<tr>${cols.map((c) => `<td>${c.key === "K-01" ? money(itemAmount(row)) : fieldById[c.key] && fieldById[c.key].type === "currency" ? money(num(row[c.key])) : esc(row[c.key] ?? "")}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${cols.length}"><span class="blank">〔${g} 반복행 미입력〕</span></td></tr>`;
      const foot = g === "품목" && rows.length ? `<tr><th colspan="${cols.length - 1}">합계금액</th><td>${money(itemTotal())}</td></tr>`
        : g === "평가" && rows.length ? `<tr><th colspan="${cols.length - 1}">총점</th><td>${evalTotal()}점</td></tr>` : "";
      return `<table><caption style="text-align:left;font-weight:700;padding:4px 0">${g}</caption><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${body}${foot}</tbody></table>`;
    };
    const school = hasValue(state.values["C-01"]) ? esc(state.values["C-01"]) : "〔학교명〕";

    $("#modalBody").innerHTML = `
      <div class="modal-head">
        <h2 id="modalTitle">${f.formId} · 매뉴얼 ${esc(f.manualNo)} · ${esc(f.title)}</h2>
        <button class="btn ghost" data-close aria-label="미리보기 닫기">✕</button>
      </div>
      <div class="modal-main">
        <div class="paper-wrap"><div class="paper">
          <div class="watermark">연습판 미리보기 — 원본 HWPX 서식 레이아웃이 아니라, 입력값이 어떤 칸에 반영되는지 확인하는 용도입니다.</div>
          <h1>${esc(f.title)}</h1>
          <table><tbody>${scalar.map((fid) => `<tr><th>${esc(fieldById[fid].label)}</th><td>${val(fid)}</td></tr>`).join("")}</tbody></table>
          ${groups.map(groupTable).join("")}
          ${f.privacyProtected ? `<p class="kept">※ 개인정보 가능 문서: 동의자 성명·주소·연락처·서명 등은 자동 입력하지 않고 빈 양식으로 출력합니다.</p>` : ""}
          <p class="sign">${hasValue(state.values["C-05"]) ? esc(fmtDate(state.values["C-05"])) + "<br>" : ""}${school}장</p>
        </div></div>
        <aside class="info-panel" aria-label="서식 정보">
          <div class="card"><h3>작성 상태</h3>${statusBadge(r)}
            ${r.missing.length ? `<p style="margin:8px 0 0;font-size:14px"><strong>누락된 필수값</strong></p><ul>${r.missing.map((fid) => `<li><a href="#/input/${tabOfField(fid)}" data-close>${esc(fieldById[fid].label)}</a></li>`).join("")}</ul>` : ""}
          </div>
          <div class="card"><h3>필수 입력값</h3><ul>${f.requiredFieldIds.map((fid) => `<li>${fieldFilled(fid) ? "✓" : "▲"} ${esc(fieldById[fid] ? fieldById[fid].label : fid)}</li>`).join("")}</ul></div>
          <div class="card"><h3>서식 정보</h3><ul>
            <li>업무단계: ${esc(f.stage)}</li><li>작성주체: ${esc(f.author)}</li><li>문서유형: ${esc(f.docType)}</li>
            <li>원본 출력방식: ${esc(OUTPUT_LABEL[f.outputMethod])}</li>
            ${f.boundary ? `<li>출력 경계: ${esc(f.boundary)}</li>` : ""}</ul>
            <p style="font-size:13px;color:var(--muted);margin:6px 0 0">HWPX 작성은 이 연습판에서 제공하지 않습니다(원본은 Excel 로컬 경로 — ADR-001).</p></div>
        </aside>
      </div>
      <div class="modal-foot">
        <a class="btn secondary" href="#/input/${r.missing.length ? tabOfField(r.missing[0]) : "common"}" data-close>기초자료 입력하기</a>
        <button class="btn" data-print>인쇄 / PDF 저장</button>
        <button class="btn secondary" data-close>닫기</button>
      </div>`;
    lastFocus = document.activeElement;
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
    $("#modal [data-close]").focus();
  }
  function closePreview() {
    if ($("#modal").hidden) return;
    $("#modal").hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  /* ---------- 7. 내보내기 ---------- */
  let resetArmed = false;
  function viewExport() {
    breadcrumb([["내보내기"]]);
    resetArmed = false;
    const p = progress();
    const ready = D.forms.filter((f) => readiness(f).code === "ok");
    return `
      <h1>내보내기</h1>
      <div class="banner info" role="note">🔒 입력한 업무자료는 서버에 저장되지 않습니다. 다음에 이어서 작업하려면 백업 파일을 내려받아 학교 PC에 보관하세요.</div>
      <div class="export-grid">
        <section class="card">
          <h2>입력자료 백업</h2>
          <p>현재 입력값(기초자료 ${p.done}/${p.total}, 반복행 포함)을 JSON 파일로 저장합니다.</p>
          <div class="btn-row"><button class="btn" data-download>백업 파일 내려받기</button></div>
          <h3 style="margin-top:20px">백업 불러오기</h3>
          <label for="restoreFile">이전에 저장한 백업 파일(.json)</label>
          <input id="restoreFile" type="file" accept=".json,application/json">
          <p class="err" id="restoreMsg" role="status" style="margin:6px 0 0"></p>
        </section>
        <section class="card">
          <h2>출력 가능한 서식</h2>
          <p>지금 바로 미리보기·인쇄할 수 있는 서식은 <strong>${ready.length}종</strong>입니다.</p>
          ${ready.length ? `<ul>${ready.slice(0, 8).map((f) => `<li><button class="btn ghost" data-preview="${f.formId}">${f.formId} ${esc(f.title)}</button></li>`).join("")}</ul>${ready.length > 8 ? `<a href="#/forms">나머지 ${ready.length - 8}종은 서식함에서 →</a>` : ""}`
            : `<p class="empty">아직 없습니다. 공통 필수값(학교명·학년도·제목 등)을 먼저 입력하세요.</p>`}
          <p style="font-size:13px;color:var(--muted)">원본 설계의 업무자료.xlsx 내려받기와 PDF/HWPX 일괄 ZIP은 이 연습판 범위에 포함하지 않았습니다.</p>
        </section>
        <section class="card">
          <h2>입력값 초기화</h2>
          <p>공용 PC에서 작업을 마쳤다면 입력값을 지워 다른 사람이 보지 않게 합니다.</p>
          <button class="btn danger" data-reset>모든 입력값 지우기</button>
          <p id="resetMsg" role="status" style="margin:6px 0 0;font-size:14px"></p>
        </section>
      </div>`;
  }
  function downloadBackup() {
    const payload = { app: "uniform-guide-practice", savedAt: new Date().toISOString(), values: state.values, rows: state.rows };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `교복구매_기초자료_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function restoreBackup(file) {
    const msg = $("#restoreMsg");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || data.app !== "uniform-guide-practice") throw new Error("이 앱에서 만든 백업 파일이 아닙니다.");
        // 알려진 Field ID만 받아들임
        const values = {};
        Object.entries(data.values || {}).forEach(([k, v]) => { if (fieldById[k] && !fieldById[k].repeatGroup && !isComputed(k)) values[k] = String(v); });
        const rows = emptyState().rows;
        Object.keys(rows).forEach((g) => {
          const allowedKeys = new Set(repeatColumns(g).map((c) => c.key));
          rows[g] = (Array.isArray(data.rows && data.rows[g]) ? data.rows[g] : []).slice(0, MAX_ROWS).map((r) =>
            Object.fromEntries(Object.entries(r || {}).filter(([k]) => allowedKeys.has(k) && !isComputed(k)).map(([k, v]) => [k, String(v)])));
        });
        state.values = values;
        state.rows = rows;
        save();
        updateBadge();
        msg.style.color = "var(--ok)";
        msg.textContent = `불러오기 완료 — 기초자료 ${progress().done}/${progress().total}`;
      } catch (e) {
        msg.style.color = "";
        msg.textContent = "불러오지 못했습니다: " + (e instanceof SyntaxError ? "JSON 형식이 아닙니다." : e.message);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  /* ---------- 8. 사용안내 ---------- */
  function viewGuide() {
    breadcrumb([["사용안내"]]);
    const terms = [
      ["Form ID", "인벤토리에서 각 업무·참고 문서를 식별하는 고유 코드. F-001~F-057을 사용함."],
      ["공통값", "여러 출력 문서에 공통으로 반영할 수 있는 학교·학년도·사업·일정의 비식별 업무값."],
      ["문서별 값", "특정 Form ID에만 적용되는 업무값. 다른 문서로 자동 전파하지 않음."],
      ["반복행", "업체·위원·품목처럼 행 수가 가변적인 데이터 묶음. 단일 셀로 저장하지 않음."],
      ["계산값", "입력값과 명시된 산식에서 재현되는 값. 사용자가 직접 입력한 확정값과 구분함."],
      ["읽기 전용 참고자료", "업무 판단에 참고하지만 자동 치환·출력 선택·입력 대상으로 삼지 않는 문서."],
      ["개인정보 가능 문서", "개인식별정보가 포함될 여지가 있어 자동 수집·저장·치환을 금지하고 빈 양식만 출력하는 문서."],
    ];
    const faq = [
      ["입력한 자료가 서버에 저장되나요?", "아니요. 이 브라우저 탭에만 임시로 보관되고 탭을 닫으면 사라집니다. 보관하려면 내보내기에서 백업 파일을 내려받으세요."],
      ["인터넷 없이도 쓸 수 있나요?", "네. 이 연습판은 index.html을 더블클릭해 여는 정적 파일이라 인터넷 연결이 필요 없습니다."],
      ["계약방법을 시스템이 정해 주나요?", "아니요. 계약방법은 담당자가 근거 법령과 추정금액을 검토해 직접 선택합니다. 화면의 적용조건은 참고용입니다."],
      ["▲ 기초자료 필요는 무슨 뜻인가요?", "그 서식의 필수값 중 아직 입력하지 않은 값이 있다는 뜻입니다. 서식 카드에서 누락 목록을 펼치면 바로 입력 화면으로 이동할 수 있습니다."],
      ["PDF는 어떻게 만드나요?", "서식 미리보기에서 [인쇄 / PDF 저장]을 누른 뒤, 인쇄 대상을 'PDF로 저장'으로 고르세요."],
    ];
    return `
      <h1>사용안내</h1>
      <p class="lead">처음 쓰는 담당자를 위한 3단계 시작 안내입니다.</p>
      <div class="steps3">
        <div class="card"><span class="num">1</span><h3>계약방식 확인</h3><p>홈이나 계약방법 안내에서 4가지 방식을 비교하고, 계약절차에서 단계별 할 일을 확인합니다.</p><a href="#/methods">계약방법 안내 →</a></div>
        <div class="card"><span class="num">2</span><h3>기초자료 입력·저장</h3><p>학교명·학년도 같은 공통값을 한 번만 입력하면 모든 서식에 반영됩니다. 마치면 백업 파일로 저장합니다.</p><a href="#/input/common">기초자료 입력 →</a></div>
        <div class="card"><span class="num">3</span><h3>서식 작성·출력</h3><p>서식함에서 ● 작성가능 서식을 골라 미리보기 후 인쇄하거나 PDF로 저장합니다.</p><a href="#/forms">서식함 →</a></div>
      </div>
      <h2>자주 묻는 질문</h2>
      ${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
      <h2 style="margin-top:24px">입력하지 않는 정보</h2>
      <ul>${D.globalForbidden.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <h2 style="margin-top:24px">용어집</h2>
      <dl class="glossary card">${terms.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join("")}</dl>`;
  }

  /* ---------- 라우터 ---------- */
  function route() {
    const parts = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/").filter(Boolean);
    const [page = "home", a, b] = parts;
    closePreview();
    setMethodColor(null);
    renderChrome(NAV.some(([k]) => k === page) ? page : "home");
    const view = $("#view");
    switch (page) {
      case "methods": view.innerHTML = viewMethods(); break;
      case "procedure": view.innerHTML = viewProcedure(a || state.method, b || 1); break;
      case "input": view.innerHTML = viewInput(a || "common"); break;
      case "forms": view.innerHTML = viewForms(); renderFormCards(); break;
      case "export": view.innerHTML = viewExport(); break;
      case "guide": view.innerHTML = viewGuide(); break;
      default: view.innerHTML = viewHome();
    }
    document.title = `${(NAV.find(([k]) => k === page) || NAV[0])[1]} · 교복 학교주관구매 길라잡이 (연습판)`;
    window.scrollTo(0, 0);
  }

  /* ---------- 이벤트 위임 ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-preview],[data-close],[data-print],[data-add-row],[data-del-row],[data-stage],[data-download],[data-reset]");
    if (!t) {
      if (e.target === $("#modal")) closePreview();
      return;
    }
    if (t.dataset.preview) openPreview(t.dataset.preview);
    else if (t.hasAttribute("data-close")) closePreview();
    else if (t.hasAttribute("data-print")) {
      document.body.classList.add("printing");
      window.print();
      document.body.classList.remove("printing");
    } else if (t.dataset.addRow) {
      const g = t.dataset.addRow;
      if (state.rows[g].length >= MAX_ROWS) return;
      state.rows[g].push({});
      save();
      route();
      const inputs = document.querySelectorAll(`[data-group="${g}"][data-row="${state.rows[g].length - 1}"]`);
      if (inputs[0]) inputs[0].focus();
    } else if (t.dataset.delRow !== undefined) {
      state.rows[t.dataset.group].splice(+t.dataset.delRow, 1);
      save();
      route();
    } else if (t.dataset.stage) {
      formsFilter.stage = t.dataset.stage;
      document.querySelectorAll("[data-stage]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.stage === formsFilter.stage)));
      renderFormCards();
    } else if (t.hasAttribute("data-download")) downloadBackup();
    else if (t.hasAttribute("data-reset")) {
      if (!resetArmed) {
        resetArmed = true;
        t.textContent = "한 번 더 누르면 모두 지워집니다";
        return;
      }
      state = emptyState();
      save();
      route();
      $("#resetMsg").textContent = "모든 입력값을 지웠습니다.";
    }
  });

  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.field) {
      const fid = el.dataset.field;
      state.values[fid] = el.value;
      const err = validate(fid, el.value);
      const errEl = document.getElementById(el.id + "-err");
      if (errEl) errEl.textContent = err;
      if (err) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
      afterEdit();
    } else if (el.dataset.group && el.dataset.col) {
      const row = state.rows[el.dataset.group][+el.dataset.row];
      row[el.dataset.col] = el.value;
      if (el.dataset.group === "품목") {
        const cell = document.querySelector(`[data-amount="${el.dataset.row}"]`);
        if (cell) cell.textContent = money(itemAmount(row));
        const tot = $("#itemTotal");
        if (tot) tot.textContent = money(itemTotal());
      }
      if (el.dataset.group === "평가") {
        const tot = $("#evalTotal");
        if (tot) tot.textContent = evalTotal() + "점";
        const max = num(row.max), score = num(row["R-07"]);
        $("#rowErr").textContent = max !== null && score !== null && score > max ? `${+el.dataset.row + 1}행: 점수가 배점보다 큽니다.` : "";
      }
      if (el.dataset.col === "R-09") $("#rowErr").textContent = validate("R-09", el.value) ? `${+el.dataset.row + 1}행 대표자 연락처: ${validate("R-09", el.value)}` : "";
      afterEdit();
    } else if (el.id === "formQ") {
      formsFilter.q = el.value;
      renderFormCards();
    }
  });
  function afterEdit() {
    save();
    updateBadge();
    const side = $("#sidePanel");
    if (side) side.innerHTML = sidePanel();
    document.querySelectorAll("[data-tab-count]").forEach((el) => { el.textContent = tabCount(TABS.find((t) => t.key === el.dataset.tabCount)); });
  }

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.check) {
      state.checks[el.dataset.check] = el.checked;
      save();
      route();
      const again = document.querySelector(`[data-check="${CSS.escape(el.dataset.check)}"]`);
      if (again) again.focus();
    } else if (el.id === "formMethod" || el.id === "formStatus") {
      formsFilter[el.id === "formMethod" ? "method" : "status"] = el.value;
      renderFormCards();
    } else if (el.id === "restoreFile" && el.files[0]) restoreBackup(el.files[0]);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePreview();
    if (e.key === "Tab" && !$("#modal").hidden) {
      // 모달 안에서 포커스 순환
      const items = [...$("#modal").querySelectorAll("a[href],button:not([disabled]),input,select,textarea")];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  $("#globalSearch").addEventListener("submit", (e) => {
    e.preventDefault();
    formsFilter.q = $("#globalSearchInput").value;
    formsFilter.stage = "전체";
    if (location.hash === "#/forms") route(); else location.hash = "#/forms";
  });

  window.addEventListener("hashchange", route);
  route();
})();
