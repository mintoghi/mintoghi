// CDP로 헤드리스 Chrome을 조작해 화면 동작을 검증한다. 사용: node e2e.js <index.html> <shots폴더>
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const fs = require("fs");
const path = require("path");
const [, , index, out] = process.argv;
const CH = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const base = pathToFileURL(index).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "cdp-"));
  const chrome = spawn(CH, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9333", `--user-data-dir=${userDir}`, "--window-size=1400,1400", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9333/json")).json(); break; } catch { await sleep(250); } }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = {}; const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value).join(" "));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.result?.value ?? r.result.exceptionDetails?.exception?.description; };
  const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); fs.writeFileSync(path.join(out, name + ".png"), Buffer.from(r.result.data, "base64")); };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url: base + "#/home" }); await sleep(800);

  const results = [];
  const check = (name, ok, info = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
  const go = async (h) => { await ev(`location.hash='${h}'`); await sleep(250); };
  const type = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);

  // 1. 모든 라우트 렌더링
  for (const r of ["home", "methods", "procedure/CM-01/1", "procedure/CM-03/4", "input/common", "input/item", "forms", "export", "guide"]) {
    await go("#/" + r);
    const len = await ev(`document.querySelector('#view').innerText.length`);
    check(`렌더링 #/${r}`, len > 100, `본문 ${len}자`);
  }
  check("모달 기본 숨김", await ev(`getComputedStyle(document.querySelector('#modal')).display==='none'`));
  await go("#/home"); check("홈 카드 4장", (await ev(`document.querySelectorAll(".method-card").length`)) === 4);

  // 2. 기초자료 입력 + 검증
  await go("#/input/common");
  await type("#in-C-01", "전주예시중학교");
  await type("#in-C-02", "2027");
  await type("#in-C-05", "2026-10-08");
  check("배지 갱신", (await ev(`document.querySelector('#progressBadge').textContent`)) === "기초자료 3/29");
  await type("#in-C-02", "27");
  check("연도 오류 안내", (await ev(`document.querySelector('#in-C-02-err').textContent`)).includes("4자리"));
  await type("#in-C-02", "2027");
  await go("#/input/biz"); await type("#in-B-01", "2027학년도 신입생 교복 구매");
  await go("#/input/doc"); await type("#in-D-02", "교복 학교주관구매 추진 계획");

  // 3. 품목 반복행 + 자동계산
  await go("#/input/item");
  await ev(`document.querySelector('[data-add-row="품목"]').click()`); await sleep(150);
  await type('[data-group="품목"][data-row="0"][data-col="R-04"]', "동복 상의");
  await type('[data-group="품목"][data-row="0"][data-col="R-05"]', "10");
  await type('[data-group="품목"][data-row="0"][data-col="R-06"]', "50000");
  check("K-01 자동계산", (await ev(`document.querySelector('[data-amount="0"]').textContent`)) === "500,000원");
  check("K-02 합계", (await ev(`document.querySelector('#itemTotal').textContent`)) === "500,000원");
  check("탭 개수 즉시 갱신", (await ev(`document.querySelector("[data-tab-count=item]").textContent`)) === "3/3");
  await shot("e2e_input_item");

  // 4. 새로고침 후 세션 유지
  await send("Page.reload"); await sleep(800);
  { const b = await ev(`document.querySelector("#progressBadge").textContent`); check("세션 유지(새로고침)", b === "기초자료 8/29", b); }

  // 5. 서식함 필터·검색
  await go("#/forms");
  check("서식함 52종", (await ev(`document.querySelector('#formCount').textContent`)) === "52종 표시");
  await ev(`document.querySelector('[data-stage="계약"]').click()`); await sleep(100);
  check("단계 필터(계약)", (await ev(`document.querySelector('#formCount').textContent`)) === "3종 표시");
  await ev(`document.querySelector('[data-stage="전체"]').click()`);
  await type("#formQ", "F-019");
  check("검색 F-019", (await ev(`document.querySelector('#formCount').textContent`)) === "1종 표시");
  await type("#formQ", "");
  const ok = await ev(`document.querySelectorAll('.form-card .status.ok').length`);
  check("작성가능 서식 존재", ok > 0, `● ${ok}종`);
  await shot("e2e_forms");

  // 6. 미리보기 모달
  await ev(`document.querySelector('[data-preview="F-019"]').click()`); await sleep(200);
  check("모달 열림", await ev(`!document.querySelector('#modal').hidden`));
  check("학교명 반영", (await ev(`document.querySelector('.paper').innerText`)).includes("전주예시중학교"));
  check("포커스 모달 안", await ev(`document.querySelector('#modal').contains(document.activeElement)`));
  await shot("e2e_preview");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(100);
  check("Esc로 닫힘", await ev(`document.querySelector('#modal').hidden`));

  // 7. 개인정보 보호 서식
  await ev(`document.querySelector('#formQ').value='F-029';document.querySelector('#formQ').dispatchEvent(new Event('input',{bubbles:true}))`); await sleep(100);
  await ev(`document.querySelector('[data-preview="F-029"]').click()`); await sleep(200);
  check("F-029 개인정보 문구", (await ev(`document.querySelector('.paper').innerText`)).includes("빈 양식"));
  await ev(`document.querySelector('#modal [data-close]').click()`);

  // 8. 계약절차 체크 → 완료 표시
  await go("#/procedure/CM-01/1");
  await ev(`document.querySelector('[data-check]').click()`); await sleep(200);
  check("체크 후 단계 완료", await ev(`document.querySelector('.stepper li').classList.contains('done')`));
  await shot("e2e_procedure");

  // 9. 초기화(2단계 확인)
  await go("#/export");
  await ev(`document.querySelector('[data-reset]').click()`);
  { const b = await ev(`document.querySelector("#progressBadge").textContent`); check("1회 클릭 시 미삭제", b === "기초자료 8/29", b); }
  await ev(`document.querySelector('[data-reset]').click()`); await sleep(150);
  check("2회 클릭 시 초기화", (await ev(`document.querySelector('#progressBadge').textContent`)) === "기초자료 0/29");

  // 10. 모바일 폭
  await send("Emulation.setDeviceMetricsOverride", { width: 400, height: 900, deviceScaleFactor: 1, mobile: true });
  for (const r of ["home", "procedure/CM-03/4", "input/item", "forms"]) {
    await go("#/" + r);
    const over = await ev(`document.documentElement.scrollWidth - window.innerWidth`);
    check(`400px 가로넘침 없음 #/${r}`, over <= 0, `초과 ${over}px`);
  }
  await go("#/procedure/CM-03/4"); await shot("e2e_mobile_procedure");

  check("콘솔 오류 0건", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  ws.close(); chrome.kill();
  process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
})();
