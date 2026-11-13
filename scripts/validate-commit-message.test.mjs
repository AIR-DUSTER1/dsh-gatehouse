import assert from "node:assert/strict";
import test from "node:test";

import { validateMessage } from "./validate-commit-message.mjs";

function getErrors(message) {
  return validateMessage(message, "test").errors;
}

test("接受单行中文提交信息", () => {
  assert.deepEqual(
    getErrors("fix: 修复 README 中未经确认的许可证说明，统一提交规范和自动校验规则"),
    [],
  );
  assert.deepEqual(getErrors("feat: 新增用户管理页面，支持账号启停和角色分配"), []);
});

test("拒绝旧式 scope、多行和不允许的 type", () => {
  assert.ok(getErrors("fix(readme): 修复文档格式").length > 0);
  assert.ok(getErrors("docs: 更新项目文档").length > 0);
  assert.ok(getErrors("fix: 修复文档格式\n\n补充正文说明").length > 0);
});

test("拒绝非中文、空泛描述和句末标点", () => {
  assert.ok(getErrors("fix: Update README wording").length > 0);
  assert.ok(getErrors("fix: WIP").length > 0);
  assert.ok(getErrors("fix: 修复文档格式。").length > 0);
  assert.ok(getErrors("fix: 1. 修复文档格式").length > 0);
});

test("拒绝冒号后缺少空格", () => {
  assert.ok(getErrors("fix:修复文档格式").length > 0);
});

test("忽略 Git 注释和末尾换行但拒绝正文", () => {
  assert.deepEqual(getErrors("fix: 修复提交信息校验\n\n# Please enter the commit message").length, 0);
  assert.ok(getErrors("fix: 修复提交信息校验\n\n实际正文").length > 0);
});
