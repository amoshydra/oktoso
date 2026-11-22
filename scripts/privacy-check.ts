/**
 * Fail when a committable artifact names the operator's environment.
 *
 * The rules are the "Privacy: every artifact is public" section of AGENTS.md.
 * This checks the working tree (tracked and untracked, minus ignored files),
 * not history; a leaked commit is a rewrite decision, not a lint failure.
 *
 * Run with `pnpm privacy:check`. Findings print a redacted sample so the check
 * never copies the value it is complaining about into a log.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const BINARY = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|pdf|mp4|m4v|webm|mov|mp3|wav|ogg|flac|zip|gz|tar|bin|node)$/i;
const SKIP = new Set(["pnpm-lock.yaml"]);
const MAX_BYTES = 2 * 1024 * 1024;

interface Rule {
  name: string;
  pattern: RegExp;
  /** A match this rule must ignore, e.g. an approved stand-in. */
  allow?: RegExp;
}

const RULES: Rule[] = [
  {
    name: "home directory",
    pattern:
      /\/home\/(?!(?:me|user|tester|pi|ubuntu|runner|example)(?:[/\s"`'.,)]|$))[A-Za-z0-9._-]+/g,
  },
  {
    name: "private IP",
    pattern:
      /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d{1,3}\.\d{1,3}\b/g,
    // TEST-NET-1 and route documentation ranges are fine.
    allow: /^192\.0\.2\./,
  },
  {
    name: "local hostname",
    pattern: /(?<!\.)\b[A-Za-z0-9][A-Za-z0-9.-]*\.(?:local|cyou|lan|home\.arpa)\b(?!\.)/gi,
    allow: /^(?:example\.com|provider\.test|oktoso\.local|hub\.local|example\.local)$/i,
  },
  {
    name: "session ref",
    pattern: /\bses_[A-Za-z0-9]{15,}\b/g,
  },
  {
    name: "bearer credential",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/g,
    allow: /Bearer\s+(?:\$\{|\$|<|>|(?:test|fake|dev|e2e|reader|smoke|example|dummy)[-_])/,
  },
  {
    name: "API key",
    pattern: /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/g,
  },
  {
    name: "AWS access key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
];

function files(): string[] {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
  });
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  );
  return [...new Set(`${tracked}${untracked}`.split("\0").filter(Boolean))].sort();
}

function redact(value: string): string {
  const visible = value.slice(0, 4);
  return `${visible}…(${value.length})`;
}

interface Finding {
  rule: string;
  file: string;
  line: number;
  sample: string;
}

const findings: Finding[] = [];

for (const file of files()) {
  if (BINARY.test(file) || SKIP.has(file)) continue;
  let text: string;
  try {
    if (statSync(file).size > MAX_BYTES) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;

  const lines = text.split("\n");
  for (const rule of RULES) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      // A line may hold several matches; report the line once per rule.
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(line))) {
        const value = match[0];
        if (rule.allow?.test(value)) continue;
        findings.push({
          rule: rule.name,
          file,
          line: index + 1,
          sample: redact(value),
        });
        break;
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`privacy:check failed — ${findings.length} finding(s)\n`);
  for (const finding of findings) {
    console.error(
      `  ${finding.file}:${finding.line}  ${finding.rule}  ${finding.sample}`,
    );
  }
  console.error(
    "\nReplace the value with an approved stand-in: 127.0.0.1, /home/me/…,",
  );
  console.error(
    "example.com, provider.test, desktop-opencode:ses_auth. See AGENTS.md.",
  );
  process.exit(1);
}

console.log(`privacy:check ok — ${files().length} files, no environment details`);
