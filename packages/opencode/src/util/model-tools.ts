/**
 * Determines whether a model should use apply_patch (GPT models) vs edit/write tools.
 * Excludes original GPT-4 and GPT-4-turbo, but allows gpt-4o, gpt-4.1+ variants.
 */
export function shouldUseApplyPatch(modelID: string): boolean {
  if (!modelID.includes("gpt-")) return false
  if (modelID.includes("oss")) return false
  // Exclude GPT-3.5 and earlier
  if (/gpt-[0-3]/.test(modelID)) return false
  // Exclude original GPT-4 and GPT-4-turbo, but NOT gpt-4o or gpt-4.1+
  if (/gpt-4($|[^o\d.])/.test(modelID)) return false
  return true
}

export * as ModelTools from "./model-tools"
