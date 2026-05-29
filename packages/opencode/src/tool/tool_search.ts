import { Effect, Schema } from "effect"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "Search query describing what kind of tool you need",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of results to return (default: 5)",
  }),
})

export type ToolSearchParams = Schema.Schema.Type<typeof Parameters>

export function createToolSearchExecute(
  getDeferredTools: () => Effect.Effect<any[]>,
  activateDeferred: (ids: string[]) => Effect.Effect<void>,
) {
  return (params: ToolSearchParams) =>
    Effect.gen(function* () {
      const query = params.query.toLowerCase()
      const limit = params.limit ?? 5

      const deferredTools = yield* getDeferredTools()

      const scored = deferredTools
        .map((tool: any) => {
          const name = tool.id.toLowerCase()
          const desc = tool.description.toLowerCase()

          let score = 0
          if (name === query) score = 100
          else if (name.includes(query)) score = 50
          else if (desc.includes(query)) score = 10

          return { tool, score }
        })
        .filter((item: any) => item.score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, limit)

      if (scored.length === 0) {
        return {
          title: "Tool Search",
          metadata: { count: 0 },
          output: `No tools found matching "${params.query}". Try a different search term or check available tools.`,
        }
      }

      const matchedIds = scored.map((item: any) => item.tool.id)
      yield* activateDeferred(matchedIds)

      const results = scored
        .map((item: any) => `- **${item.tool.id}**: ${item.tool.description}`)
        .join("\n")

      return {
        title: "Tool Search Results",
        metadata: { count: scored.length },
        output: `Found ${scored.length} tool(s) matching "${params.query}":\n\n${results}\n\nTool(s) activated and available for use.`,
      }
    })
}
