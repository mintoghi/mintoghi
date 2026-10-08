// 원본 마스터 JSON(_workspace/05_web/data)을 읽기 전용으로 읽어 data/data.js로 변환한다.
// file:// 에서는 fetch가 막히므로 전역 변수(window.APP_DATA)로 싣는다.
// 실행: node tools/build-data.js   (_practice_webapp 폴더에서)
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "../../_workspace/05_web/data");
const OUT = path.resolve(__dirname, "../data/data.js");
const read = (f) => JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"));

const cm = read("contract-methods.json");
const wf = read("workflows.json");
const fm = read("forms.json");
const fd = read("fields.json");

const data = {
  generatedFrom: SRC.replace(/\\/g, "/").split("/").slice(-3).join("/"),
  contractMethods: cm.contractMethods.map((c) => ({
    id: c.id, label: c.webDisplayLabel, workflowId: c.workflowId, stepCount: c.stepCount,
    note: c.applicabilityNote, guide: c.excelGuideText, color: c.webThemeColor,
    commonForms: c.commonRequiredForms || null, commonFormsRaw: c.commonRequiredFormsRaw, dedicatedForms: c.dedicatedCoreForms,
    workflowFormIds: c.workflowFormIds,
  })),
  workflows: wf.workflows.map((w) => ({
    workflowId: w.workflowId,
    steps: w.steps.map((s) => ({
      stepNo: s.stepNo, stepName: s.stepName, description: s.description, assignee: s.assignee,
      formIds: s.formIds,
      checklist: s.checklistItems.map((i) => i.text),
      cautions: s.cautions.map((i) => ({ text: i.text, confirm: i.evidenceStatus === "manual-confirmation-required" })),
    })),
  })),
  forms: fm.forms.map((f) => ({
    formId: f.formId, manualNo: f.manualNo, title: f.title, stage: f.stage, docType: f.docType,
    author: f.author, contractMethods: f.contractMethods, workflowSteps: f.workflowSteps,
    inputFieldIds: f.inputFieldIds, requiredFieldIds: f.requiredFieldIds,
    computedFieldIds: f.computedFieldIds, boundary: f.boundary,
    implementationStatus: f.implementationStatus, outputMethod: f.outputMethod,
    privacyProtected: f.privacyProtected, privacyAllowedFieldIds: f.privacyAllowedFieldIds,
  })),
  fields: fd.fields.map((f) => ({
    fieldId: f.fieldId, label: f.label, group: f.group, repeatGroup: f.repeatGroup,
    type: f.type, required: f.required, validation: f.validation,
  })),
  repeatGroups: fd.repeatGroups.map((g) => ({ group: g.group, fieldIds: g.fieldIds })),
  globalForbidden: fd.globalForbidden.map((g) => g.label),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, "// 자동 생성 파일 — 직접 수정하지 말고 tools/build-data.js를 다시 실행하세요.\nwindow.APP_DATA = " + JSON.stringify(data) + ";\n", "utf8");
console.log(`계약방법 ${data.contractMethods.length} · 워크플로 ${data.workflows.length} · 서식 ${data.forms.length} · 필드 ${data.fields.length} → ${OUT}`);
