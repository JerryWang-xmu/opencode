#!/usr/bin/env bun

/**
 * Detects flaky tests by comparing multiple test run results.
 *
 * Usage: bun run script/detect-flaky.ts <run1.json> <run2.json> <run3.json>
 *
 * A test is considered flaky if it has inconsistent pass/fail results across runs.
 * Exits non-zero if any flaky tests are detected.
 * Writes flaky-tests.json for CI consumption.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

interface TestResult {
  name: string
  status: "pass" | "fail"
  duration: number
}

interface TestRun {
  tests: TestResult[]
}

interface FlakyTest {
  name: string
  passRate: number
  flakyRuns: number
  totalRuns: number
  durations: number[]
}

// Bun's JSON reporter outputs one JSON object per line (NDJSON).
// Each line can be a test event. We look for test completion events.
function parseBunJsonReport(content: string): TestResult[] {
  const results: TestResult[] = []
  const lines = content.split("\n").filter((line) => line.trim())

  for (const line of lines) {
    try {
      const event = JSON.parse(line)

      // Bun test JSON reporter emits events with type "test"
      if (event.type === "test" && event.event === "test" && event.name) {
        results.push({
          name: event.name,
          status: event.status === "pass" || event.status === "ok" ? "pass" : "fail",
          duration: event.duration ?? event.elapsed ?? 0,
        })
      }

      // Alternative format: top-level "tests" array
      if (event.tests && Array.isArray(event.tests)) {
        for (const t of event.tests) {
          results.push({
            name: t.name ?? t.file ?? "unknown",
            status: t.status === "pass" || t.status === "ok" ? "pass" : "fail",
            duration: t.duration ?? t.elapsed ?? 0,
          })
        }
      }
    } catch {
      // Skip non-JSON lines (bun may output non-JSON text before/after)
    }
  }

  return results
}

// Fallback: parse text output looking for pass/fail patterns.
function parseTextReport(content: string): TestResult[] {
  const results: TestResult[] = []
  const lines = content.split("\n")

  for (const line of lines) {
    // Match patterns like "✓ test name (Xms)" or "✗ test name" or "PASS test name"
    const passMatch = line.match(/[✓✔√]\s+(.+?)(?:\s+\((\d+(?:\.\d+)?)m?s\))?\s*$/)
    if (passMatch) {
      results.push({
        name: passMatch[1].trim(),
        status: "pass",
        duration: passMatch[2] ? parseFloat(passMatch[2]) : 0,
      })
      continue
    }

    const failMatch = line.match(/[✗✘×𝘅]\s+(.+?)(?:\s+\((\d+(?:\.\d+)?)m?s\))?\s*$/)
    if (failMatch) {
      results.push({
        name: failMatch[1].trim(),
        status: "fail",
        duration: failMatch[2] ? parseFloat(failMatch[2]) : 0,
      })
    }
  }

  return results
}

function parseReport(content: string): TestResult[] {
  const jsonResults = parseBunJsonReport(content)
  if (jsonResults.length > 0) return jsonResults
  return parseTextReport(content)
}

// Main
const files = process.argv.slice(2)

if (files.length < 2) {
  console.error("Usage: bun run script/detect-flaky.ts <run1.json> <run2.json> [run3.json ...]")
  console.error("Provide at least 2 test result files.")
  process.exit(1)
}

console.log(`Analyzing ${files.length} test runs for flaky tests...\n`)

// Parse all runs
const runs: TestResult[][] = []
for (const file of files) {
  try {
    const content = readFileSync(file, "utf-8")
    const results = parseReport(content)
    runs.push(results)
    console.log(`  ${file}: ${results.length} tests parsed`)
  } catch (err) {
    console.error(`  ${file}: failed to read (${err})`)
    runs.push([])
  }
}

// Build a map of test name -> results across runs
const testMap = new Map<string, { statuses: ("pass" | "fail")[]; durations: number[] }>()

for (const run of runs) {
  const seen = new Set<string>()
  for (const result of run) {
    const entry = testMap.get(result.name) ?? { statuses: [], durations: [] }
    entry.statuses.push(result.status)
    entry.durations.push(result.duration)
    testMap.set(result.name, entry)
    seen.add(result.name)
  }

  // Tests not present in this run get no entry (not counted as fail)
}

// Detect flaky tests
const flakyTests: FlakyTest[] = []

for (const [name, { statuses, durations }] of testMap) {
  if (statuses.length < 2) continue

  const passCount = statuses.filter((s) => s === "pass").length
  const failCount = statuses.filter((s) => s === "fail").length

  // A test is flaky if it has both passes and failures across runs
  if (passCount > 0 && failCount > 0) {
    flakyTests.push({
      name,
      passRate: Math.round((passCount / statuses.length) * 100),
      flakyRuns: failCount,
      totalRuns: statuses.length,
      durations,
    })
  }
}

// Sort by pass rate (most flaky first)
flakyTests.sort((a, b) => a.passRate - b.passRate)

// Write results
const artifactsDir = join(import.meta.dir, "..", ".artifacts")
mkdirSync(artifactsDir, { recursive: true })

const outputPath = join(artifactsDir, "flaky-tests.json")
writeFileSync(outputPath, JSON.stringify(flakyTests, null, 2))

// Also write to the location the workflow downloads
const flakyOutputPath = join(import.meta.dir, "..", ".artifacts", "flaky-tests.json")
writeFileSync(flakyOutputPath, JSON.stringify(flakyTests, null, 2))

// Print results
console.log("\n" + "=".repeat(60))
console.log("FLAKY TEST DETECTION RESULTS")
console.log("=".repeat(60))
console.log(`Total tests analyzed: ${testMap.size}`)
console.log(`Test runs compared: ${runs.length}`)
console.log(`Flaky tests found: ${flakyTests.length}\n`)

if (flakyTests.length > 0) {
  for (const test of flakyTests) {
    console.log(`  ❌ ${test.name}`)
    console.log(`     Pass rate: ${test.passRate}% (${test.totalRuns - test.flakyRuns}/${test.totalRuns} passed)`)
    console.log(`     Durations: ${test.durations.map((d) => `${d}ms`).join(", ")}`)
    console.log()
  }

  console.log("=".repeat(60))
  console.error(`\n❌ ${flakyTests.length} flaky test(s) detected. Failing the check.`)
  process.exit(1)
}

console.log("✅ No flaky tests detected.")
