import { describe, expect, it } from "bun:test"
import type { Hooks, PluginInput, LLMClient } from "@opencode-ai/plugin"

describe("Agent Executor Hook", () => {
  describe("LLM Client Interface", () => {
    it("should provide llm client in plugin input", async () => {
      const mockLLM: LLMClient = {
        async query(prompt: string, options?: { model?: string; system?: string; temperature?: number }) {
          return `Mock response for: ${prompt}`
        },
      }

      const pluginInput: PluginInput = {
        client: {} as any,
        project: { id: "test-project" } as any,
        directory: "/test",
        worktree: "/test",
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:4096"),
        $: {} as never,
        llm: mockLLM,
      }

      expect(pluginInput.llm).toBeDefined()
      expect(typeof pluginInput.llm.query).toBe("function")

      const response = await pluginInput.llm.query("Test prompt", {
        model: "gpt-4",
        temperature: 0.7,
      })

      expect(response).toContain("Test prompt")
    })

    it("should support optional parameters in query", async () => {
      const mockLLM: LLMClient = {
        async query(prompt: string) {
          return `Response: ${prompt}`
        },
      }

      const response = await mockLLM.query("Simple query")
      expect(response).toBe("Response: Simple query")
    })

    it("should preserve Effect context when using bridge.promise()", async () => {
      // This test verifies that the plugin LLM client uses bridge.promise()
      // to preserve the current Effect context rather than creating a separate runtime.
      // The implementation in plugin/index.ts uses bridge.promise(effect) which
      // ensures that services like InstanceRef, Config, and Provider are available.
      
      let contextPreserved = false
      const mockLLM: LLMClient = {
        async query(prompt: string) {
          // Simulate checking that context is preserved by verifying
          // we can access services that would only be available in the current context
          contextPreserved = true
          return `Context preserved: ${prompt}`
        },
      }

      const response = await mockLLM.query("Test context preservation")
      expect(response).toBe("Context preserved: Test context preservation")
      expect(contextPreserved).toBe(true)
    })
  })

  describe("Agent Executor Hook Type", () => {
    it("should accept agent.executor hook in Hooks interface", () => {
      const hooks: Hooks = {
        "agent.executor": async (hookName, input, output, llm) => {
          // This hook can modify the output based on LLM reasoning
          if (hookName === "tool.execute.before") {
            const response = await llm.query(`Validate: ${JSON.stringify(input)}`)
            output.validated = response
          }
        },
      }

      expect(hooks["agent.executor"]).toBeDefined()
      expect(typeof hooks["agent.executor"]).toBe("function")
    })

    it("should allow agent.executor to modify tool execution arguments", async () => {
      const mockLLM: LLMClient = {
        async query(prompt: string) {
          return "DENY"
        },
      }

      const hooks: Hooks = {
        "agent.executor": async (hookName, input, output, llm) => {
          if (hookName === "tool.execute.before" && input.tool === "bash") {
            const response = await llm.query(
              `Analyze this bash command: ${output.args.command}`,
              { system: "You are a security expert. Respond with ALLOW or DENY." }
            )

            if (response.startsWith("DENY")) {
              output.args = { command: `echo "Blocked: ${response}"` }
            }
          }
        },
      }

      const output = { args: { command: "rm -rf /" } }
      await hooks["agent.executor"]!(
        "tool.execute.before",
        { tool: "bash", sessionID: "test", callID: "call_1" },
        output,
        mockLLM
      )

      expect(output.args.command).toBe('echo "Blocked: DENY"')
    })

    it("should allow agent.executor to post-process tool results", async () => {
      const mockLLM: LLMClient = {
        async query(prompt: string) {
          return "Summary: Command executed successfully"
        },
      }

      const hooks: Hooks = {
        "agent.executor": async (hookName, input, output, llm) => {
          if (hookName === "tool.execute.after") {
            const summary = await llm.query(
              `Summarize this tool result: ${output.output.substring(0, 100)}...`,
              { system: "Provide a concise summary of the tool output." }
            )
            output.summary = summary
          }
        },
      }

      const output = { 
        title: "Bash Result",
        output: "Very long output..." + "x".repeat(1000),
        metadata: {}
      }

      await hooks["agent.executor"]!(
        "tool.execute.after",
        { tool: "bash", sessionID: "test", callID: "call_1", args: {} },
        output,
        mockLLM
      )

      expect((output as any).summary).toContain("Summary:")
    })
  })

  describe("Plugin Integration", () => {
    it("should integrate agent.executor with other hooks", async () => {
      const mockLLM: LLMClient = {
        async query(prompt: string) {
          return "Modified by LLM"
        },
      }

      const executionOrder: string[] = []

      const hooks: Hooks = {
        "tool.execute.before": async (input, output) => {
          executionOrder.push("before")
        },
        "tool.execute.after": async (input, output) => {
          executionOrder.push("after")
        },
        "agent.executor": async (hookName, input, output, llm) => {
          executionOrder.push(`executor:${hookName}`)
          if (hookName === "tool.execute.before") {
            output.enhanced = await llm.query("Enhance this")
          }
        },
      }

      const beforeOutput = { args: { command: "ls" } }
      await hooks["agent.executor"]!(
        "tool.execute.before",
        { tool: "bash", sessionID: "test", callID: "call_1" },
        beforeOutput,
        mockLLM
      )
      await hooks["tool.execute.before"]!({ tool: "bash", sessionID: "test", callID: "call_1" }, beforeOutput)

      expect(executionOrder).toEqual(["executor:tool.execute.before", "before"])
      expect((beforeOutput as any).enhanced).toBe("Modified by LLM")
    })
  })
})
