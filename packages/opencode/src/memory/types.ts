import { Schema } from "effect"

export const MemoryType = Schema.Union([
  Schema.Literal("user"),
  Schema.Literal("feedback"),
  Schema.Literal("project"),
  Schema.Literal("reference"),
])
export type MemoryType = Schema.Schema.Type<typeof MemoryType>

export const MemoryEntry = Schema.Struct({
  id: Schema.String,
  type: MemoryType,
  name: Schema.String,
  description: Schema.String,
  content: Schema.String,
  tags: Schema.optional(Schema.Array(Schema.String)),
  created: Schema.Number,
  updated: Schema.Number,
  source: Schema.optional(
    Schema.Struct({
      sessionID: Schema.String,
      messageID: Schema.String,
    }),
  ),
})
export type MemoryEntry = Schema.Schema.Type<typeof MemoryEntry>

export const MEMORY_INDEX_MAX_LINES = 200
export const MEMORY_MAX_CONTENT_LENGTH = 2000
