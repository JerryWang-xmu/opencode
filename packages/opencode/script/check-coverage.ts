#!/usr/bin/env bun

/**
 * Parses bun test --coverage output and enforces a minimum coverage threshold.
 *
 * Usage: bun run script/check-coverage.ts --threshold 80
 *
 * Exits non-zero if any metric falls below the threshold.
 * Writes coverage-summary.json for CI consumption.
 */

import { spawnSync } from "bun"
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"

const thresholdArg = process.argv.indexOf("--threshold")
const threshold = thresholdArg !== -1 ? Number(process.argv[thresholdArg + 1]) : 80

if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
  console.error(`Invalid threshold: ${process.argv[thresholdArg + 1]}. Must be 0-100.`)
  process.exit(1)
}

console.log(`Running tests with coverage (threshold: ${threshold}%)...\n`)

const result = spawnSync({
  cmd: ["bun", "test", "--timeout", "30000", "--coverage"],
  stdout: "pipe",
  stderr: "pipe",
})

const stdout = result.stdout.toString()
const stderr = result.stderr.toString()

process.stdout.write(stdout)
if (stderr) process.stderr.write(stderr)

// Parse coverage table from bun output.
// Bun outputs a table like:
//   % coverage | ... | file
//   ---------- | ... | ----
//   85.71 | ... | src/foo.ts
//
// Or a summary line with overall percentages.
// We look for the summary metrics: lines, functions, branches, statements.

const summary = {
  lines: 0,
  functions: 0,
  branches: 0,
  statements: 0,
  threshold,
  passed: true,
  details: [] as { metric: string; value: number; passed: boolean }[],
}

// Bun's coverage summary typically includes lines like:
//   "X lines covered / Y total lines" or percentage patterns
// Parse percentage values from the coverage output.
const coveragePatterns = [
  { regex: /(\d+(?:\.\d+)?)%\s+lines?\s+covered/i, key: "lines" as const },
  { regex: /(\d+(?:\.\d+)?)%\s+functions?\s+covered/i, key: "functions" as const },
  { regex: /(\d+(?:\.\d+)?)%\s+branches?\s+covered/i, key: "branches" as const },
  { regex: /(\d+(?:\.\d+)?)%\s+statements?\s+covered/i, key: "statements" as const },
]

for (const { regex, key } of coveragePatterns) {
  const match = stdout.match(regex)
  if (match) {
    summary[key] = parseFloat(match[1])
  }
}

// Fallback: if bun outputs a compact table, try to parse the overall row.
// Pattern: "All files | XX.XX | XX.XX | XX.XX | XX.XX |"
const allFilesMatch = stdout.match(
  /All files\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|/,
)
if (allFilesMatch) {
  summary.statements = parseFloat(allFilesMatch[1])
  summary.branches = parseFloat(allFilesMatch[2])
  summary.functions = parseFloat(allFilesMatch[3])
  summary.lines = parseFloat(allFilesMatch[4])
}

// If no coverage data found at all, try generic percentage extraction from last 20 lines.
if (summary.lines === 0 && summary.functions === 0 && summary.branches === 0 && summary.statements === 0) {
  const tailLines = stdout.split("\n").slice(-30).join("\n")
  const percentages = [...tailLines.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => parseFloat(m[1]))
  if (percentages.length >= 1) {
    // Assign to available metrics in order
    const keys = ["lines", "functions", "branches", "statements"] as const
    for (let i = 0; i < Math.min(percentages.length, keys.length); i++) {
      summary[keys[i]] = percentages[i]
    }
  }
}

// Evaluate threshold
const metrics = ["lines", "functions", "branches", "statements"] as const
for (const metric of metrics) {
  const value = summary[metric]
  const passed = value >= threshold
  summary.details.push({ metric, value, passed })
  if (!passed) summary.passed = false
}

// Write summary JSON for CI consumption
const artifactsDir = join(import.meta.dir, "..", ".artifacts")
mkdirSync(artifactsDir, { recursive: true })

const summaryPath = join(artifactsDir, "..", "coverage", "coverage-summary.json")
mkdirSync(join(artifactsDir, "..", "coverage"), { recursive: true })
writeFileSync(summaryPath, JSON.stringify(summary, null, 2))

// Also write to the location the workflow expects
const coverageDir = join(import.meta.dir, "..", "coverage")
mkdirSync(coverageDir, { recursive: true })
writeFileSync(join(coverageDir, "coverage-summary.json"), JSON.stringify(summary, null, 2))

// Print results
console.log("\n" + "=".repeat(60))
console.log("COVERAGE THRESHOLD CHECK")
console.log("=".repeat(60))
console.log(`Threshold: ${threshold}%\n`)

for (const { metric, value, passed } of summary.details) {
  const icon = passed ? "✅" : "❌"
  console.log(`  ${icon} ${metric.padEnd(12)} ${value.toFixed(2)}%`)
}

console.log("\n" + "=".repeat(60))

if (!summary.passed) {
  console.error(`\n❌ Coverage below ${threshold}% threshold. Failing the check.`)
  process.exit(1)
}

console.log(`\n✅ All coverage metrics meet the ${threshold}% threshold.`)
