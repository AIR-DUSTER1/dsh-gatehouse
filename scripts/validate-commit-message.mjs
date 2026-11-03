#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TYPES = new Set([
  "feat",
  "fix",
  "refactor",
  "perf",
  "test",
  "docs",
  "style",
  "build",
  "ci",
  "chore",
  "revert",
  "merge",
]);

const HEADER_MAX = 100;
const SUBJECT_MAX = 72;
const HEADER_RE = /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9][a-z0-9._/-]*)\))?(?<breaking>!)?: (?<subject>.+)$/;

function usage() {
  console.error(
    "Usage: node scripts/validate-commit-message.mjs <commit-message-file> | --last | --range <git-range>",
  );
}

function cleanMessage(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
}

function validateMessage(raw, source) {
  const message = cleanMessage(raw);
  const lines = message.split(/\r?\n/);
  const header = lines[0]?.trim() ?? "";
  const errors = [];

  if (!header) {
    errors.push("提交信息不能为空");
    return { errors, header, source };
  }

  const match = HEADER_RE.exec(header);
  if (!match?.groups) {
    errors.push(
      "header 必须符合 `<type>(<scope>)!: <subject>`，例如 `feat(web): add status filter`",
    );
  } else {
    const { type, subject, breaking } = match.groups;
    if (!TYPES.has(type)) {
      errors.push(`不允许的 type \`${type}\`；允许：${[...TYPES].join(", ")}`);
    }
    if (!subject || subject.trim() !== subject) {
      errors.push("subject 不能为空或带有首尾空白");
    }
    if (subject.endsWith(".")) {
      errors.push("subject 不能以句号结尾");
    }
    if ([...subject].length > SUBJECT_MAX) {
      errors.push(`subject 不能超过 ${SUBJECT_MAX} 个字符`);
    }
    if (breaking && !lines.slice(1).some((line) => /^BREAKING(?: |-)CHANGE: /.test(line))) {
      errors.push("使用 `!` 时必须在 footer 添加 `BREAKING CHANGE: ...`");
    }
  }

  if ([...header].length > HEADER_MAX) {
    errors.push(`header 不能超过 ${HEADER_MAX} 个字符`);
  }
  if (lines.length > 1 && lines[1].trim() !== "") {
    errors.push("header 与正文之间必须空一行");
  }
  for (const [index, line] of lines.slice(1).entries()) {
    if (line.length > 100 && !/^https?:\/\//.test(line.trim())) {
      errors.push(`第 ${index + 2} 行超过 100 个字符`);
    }
  }

  return { errors, header, source };
}

function report(results) {
  let failed = false;
  for (const result of results) {
    if (result.errors.length === 0) continue;
    failed = true;
    console.error(`\n✗ ${result.source}`);
    console.error(`  ${result.header || "(空)"}`);
    for (const error of result.errors) console.error(`  - ${error}`);
  }
  if (failed) {
    console.error("\n提交信息未通过校验，请按 AGENTS.md 的 Git 规范修改后重试。");
    process.exitCode = 1;
    return;
  }
  console.log(`✓ 已校验 ${results.length} 个提交信息`);
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    ...options,
  });
}

function readFileOrThrow(path) {
  try {
    return readFileSync(resolve(path), "utf8");
  } catch {
    throw new Error(`无法读取提交信息文件：${path}`);
  }
}

function main() {
  const [mode, value] = process.argv.slice(2);

  if (!mode || mode === "--help" || mode === "-h") {
    usage();
    process.exitCode = mode ? 0 : 1;
    return;
  }

  if (mode === "--last") {
    const message = git(["log", "-1", "--format=%B"]).trim();
    report([validateMessage(message, "HEAD")]);
    return;
  }

  if (mode === "--range") {
    if (!value) throw new Error("--range 需要一个 Git 提交范围，例如 origin/main..HEAD");
    const hashes = git(["rev-list", "--reverse", value]).trim().split(/\s+/).filter(Boolean);
    if (hashes.length === 0) {
      console.log("✓ 指定范围没有需要校验的提交");
      return;
    }
    report(
      hashes.map((hash) => {
        const message = git(["show", "-s", "--format=%B", hash]).trim();
        return validateMessage(message, `${hash.slice(0, 12)} ${message.split(/\r?\n/, 1)[0]}`);
      }),
    );
    return;
  }

  report([validateMessage(readFileOrThrow(mode), mode)]);
}

try {
  main();
} catch (error) {
  console.error(`提交信息校验失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}