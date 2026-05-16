import { WebContents } from "electron";
import {
  jsonSchema,
  Schema,
  stepCountIs,
  streamText,
  TextStreamPart,
  type CoreMessage,
  type LanguageModel,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";

// Flags
const USE_SCREENSHOT = false;

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, "../../.env") });

interface ChatRequest {
  message: string;
  messageId: string;
}

type LLMProvider = "openai" | "anthropic";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
};

const DEFAULT_TEMPERATURE = 0.7;

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly provider: LLMProvider;
  private readonly modelName: string;
  private readonly model: LanguageModel | null;
  private messages: CoreMessage[] = [];

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.provider = this.getProvider();
    this.modelName = this.getModelName();
    this.model = this.initializeModel();

    this.logInitializationStatus();
  }

  // Set the window reference after construction to avoid circular dependencies
  setWindow(window: Window): void {
    this.window = window;
  }

  private getProvider(): LLMProvider {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    if (provider === "anthropic") return "anthropic";
    return "openai"; // Default to OpenAI
  }

  private getModelName(): string {
    return process.env.LLM_MODEL || DEFAULT_MODELS[this.provider];
  }

  private initializeModel(): LanguageModel | null {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    switch (this.provider) {
      case "anthropic":
        return anthropic(this.modelName);
      case "openai":
        return openai(this.modelName);
      default:
        return null;
    }
  }

  private getApiKey(): string | undefined {
    switch (this.provider) {
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY;
      case "openai":
        return process.env.OPENAI_API_KEY;
      default:
        return undefined;
    }
  }

  private logInitializationStatus(): void {
    if (this.model) {
      console.log(
        `✅ LLM Client initialized with ${this.provider} provider using model: ${this.modelName}`
      );
    } else {
      const keyName =
        this.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      console.error(
        `❌ LLM Client initialization failed: ${keyName} not found in environment variables.\n` +
          `Please add your API key to the .env file in the project root.`
      );
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      // Get screenshot from active tab if available
      let screenshot: string | null = null;
      if (this.window?.activeTab) {
        try {
          const image = await this.window?.activeTab.screenshot();
          screenshot = image.toDataURL();
        } catch (error) {
          console.error("Failed to capture screenshot:", error);
        }
      }

      // Build user message content with screenshot first, then text
      const userContent: any[] = [];
      
      // Add screenshot as the first part if available
      if (USE_SCREENSHOT && screenshot) {
        userContent.push({
          type: "image",
          image: screenshot,
        });
      }
      
      // Add text content
      userContent.push({
        type: "text",
        text: request.message,
      });

      // Create user message in CoreMessage format
      const userMessage: CoreMessage = {
        role: "user",
        content: userContent.length === 1 ? request.message : userContent,
      };

      console.log('@@@@@@@@@ userMessage @@@@@@@@@');
      console.log(userMessage);
      console.log('@@@@@@@@@ end userMessage @@@@@@@@@');
      
      this.messages.push(userMessage);

      // Send updated messages to renderer
      this.sendMessagesToRenderer();

      if (!this.model) {
        this.sendErrorMessage(
          "LLM service is not configured. Please add your API key to the .env file."
        );
        return;
      }

      const { system, messages } = await this.prepareMessagesWithContext(request);
      await this.streamResponse(system, messages);
    } catch (error) {
      console.error("Error in LLM request:", error);
      this.handleStreamError(error);
    }
  }

  clearMessages(): void {
    this.messages = [];
    this.sendMessagesToRenderer();
  }

  getMessages(): CoreMessage[] {
    return this.messages;
  }

  private sendMessagesToRenderer(): void {
    this.webContents.send("chat-messages-updated", this.messages);
  }

  private async prepareMessagesWithContext(_request: ChatRequest): Promise<{
    system: string;
    messages: CoreMessage[];
  }> {
    // Get page context from active tab
    let pageUrl: string | null = null;
    let pageText: string | null = null;

    if (this.window) {
      const activeTab = this.window.activeTab;
      if (activeTab) {
        pageUrl = activeTab.url;
        try {
          pageText = await activeTab.getTabText();
        } catch (error) {
          console.error("Failed to get page text:", error);
        }
      }
    }

    return {
      system: this.buildSystemPrompt(pageUrl, pageText),
      messages: this.messages,
    };
  }

  private buildSystemPrompt(url: string | null, _pageText: string | null): string {
    const parts: string[] = [
      "You are a helpful AI assistant integrated into a web browser.",
      "You can analyze and discuss web pages with the user.",
      "The user's messages may include screenshots of the current page as the first image.",
      "See if clues are present in the current page.",
      "Navigate to different pages if information doesnt exist on current page. If the user names another site or resource, load the URL that actually hosts it instead of inferring from the current tab alone.",
      "Think critically about each tool result. If a tool returns empty or no useful data, you must call a tool again with a different approach. Infer structure from the live DOM, widen or change your strategy, sanity-check that you are even querying the right document state — do not answer as if the page were empty unless you have verified that a materially different approach still finds nothing.",
      "For web_content_visit_and_inject_javascript, the script field must be function-body code that uses return to produce the value you want from the page.",
      "Treat every loaded document as unfamiliar: do not rely on memorized page structure, tutorials, Stack Overflow snippets, or typical markup from training. Derive selectors and extraction steps only from tool results you just obtained from this session (excerpts, counts, tags, attributes)—think from scratch each time.",
      "If a script returns [], null, or blank strings, never repeat that exact script on the same URL. Next call must change strategy: observe the real DOM first (e.g. short innerText or HTML snippets, tentative querySelector counts based on what those snippets suggest), then extract using selectors you justify only from that fresh evidence.",
      "Never invent path segments, query keys, or numeric ids. Before you pass a non-listing URL to the tool, that exact query string (including digits) must appear in a string your script returned on the current site in this conversation, or in the browser address bar — not merely inferred from a title visible in text.",
      "After you load a URL, sanity-check briefly (e.g. returned title or heading text) that the document matches the user’s topic before summarizing; if it clearly does not, go back and re-extract the correct link from the listing.",
    ];

    if (url) {
      parts.push(`Current page URL: ${url}`);
    }

    return parts.join("\n");
  }

  private async streamResponse(system: string, messages: CoreMessage[]): Promise<void> {
    if (!this.model) {
      throw new Error("Model not initialized");
    }

    try {
      const result = await streamText({
        model: this.model,
        system,
        messages,
        temperature: DEFAULT_TEMPERATURE,
        maxRetries: 5,
        abortSignal: undefined, // Could add abort controller for cancellation
        stopWhen: stepCountIs(8), // NOTE(Carl): Arbitrary limit so we have enough steps for processing data and navigating.
        tools: {
          web_content_visit_and_inject_javascript: {
            description:
              "Load url in the active tab, then run JavaScript. The script is inserted as the body of a try block inside an IIFE. Use return for the tool result. Do not assume memorized DOM layouts for any site; infer structure from what this navigation returns. If the prior tool result was empty and you did not change the script materially, run a short diagnostic or revise selectors instead of repeating.",
            inputSchema: jsonSchema<{ url: string; script: string }>({
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description:
                    "The URL to visit.",
                },
                script: {
                  type: "string",
                  description:
                    "Function body (statements). Must return the tool result, e.g. return document.documentElement.innerText;",
                },
              },
              required: ["url", "script"],
            }),
            execute: async ({ url, script }: { url: string, script: string }) => {
              const tab = this.window?.activeTab;
              return await tab?.runExclusive(async () => {
                if (process.env.NODE_ENV === "development") {
                  console.log('@@@@@@@@@ begin web_content_visit_and_inject_javascript @@@@@@@@@');
                  console.log('@@@@@@@@@ begin url @@@@@@@@@');
                  console.log(url);
                  console.log('@@@@@@@@@ end url @@@@@@@@@');
                  console.log('@@@@@@@@@ begin script @@@@@@@@@');
                  console.log(script);
                  console.log('@@@@@@@@@ end script @@@@@@@@@');
                }

                const alreadyOnPage = tab?.url === url;
                if (process.env.NODE_ENV === "development" && alreadyOnPage) {
                  console.log('@@@@@@@@@ skip loadURL (already on page) @@@@@@@@@');
                }
                if (!alreadyOnPage) {
                  await tab?.loadURL(url);
                }

                const runResult = await tab?.runJs(script);
                if (process.env.NODE_ENV === "development") {
                  console.log('@@@@@@@@@ runResult @@@@@@@@@');
                  console.log(JSON.stringify(runResult));
                  console.log('@@@@@@@@@ end runResult @@@@@@@@@');
                }
                if (process.env.NODE_ENV === "development") {
                  console.log('@@@@@@@@@ end web_content_visit_and_inject_javascript @@@@@@@@@');
                }

                return runResult;
              });
            }
          }
        },
      });

      await this.processStream(result.fullStream);
    } catch (error) {
      throw error; // Re-throw to be handled by the caller
    }
  }

  private async processStream(
    fullStream: AsyncIterable<TextStreamPart<{ web_content_visit_and_inject_javascript: { description: string; inputSchema: Schema<{ url: string; script: string; }>; execute: ({ url, script }: { url: string; script: string; }) => Promise<void | undefined>; }; }>>,
  ): Promise<void> {
    let accumulatedText = "";

    // Create a placeholder assistant message
    const assistantMessage: CoreMessage = {
      role: "assistant",
      content: "",
    };
    
    // Keep track of the index for updates
    const messageIndex = this.messages.length;
    this.messages.push(assistantMessage);

    for await (const chunk of fullStream) {
      if (chunk.type === "text-delta") {
        accumulatedText += chunk.text;

        // Update assistant message content
        this.messages[messageIndex] = {
          role: "assistant",
          content: accumulatedText,
        };
        this.sendMessagesToRenderer();
      }
    }

    // Final update with complete content
    this.messages[messageIndex] = {
      role: "assistant",
      content: accumulatedText,
    };
    this.sendMessagesToRenderer();
  }

  private handleStreamError(error: unknown): void {
    console.error("Error streaming from LLM:", error);

    const errorMessage = this.getErrorMessage(error);
    this.sendErrorMessage(errorMessage);
  }

  private getErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return "An unexpected error occurred. Please try again.";
    }

    const message = error.message.toLowerCase();

    if (message.includes("401") || message.includes("unauthorized")) {
      return "Authentication error: Please check your API key in the .env file.";
    }

    if (message.includes("429") || message.includes("rate limit")) {
      return "Rate limit exceeded. Please try again in a few moments.";
    }

    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("econnrefused")
    ) {
      return "Network error: Please check your internet connection.";
    }

    if (message.includes("timeout")) {
      return "Request timeout: The service took too long to respond. Please try again.";
    }

    return "Sorry, I encountered an error while processing your request. Please try again.";
  }

  private sendErrorMessage(errorMessage: string): void {
    this.messages.push({
      role: "assistant",
      content: errorMessage,
    });
    this.sendMessagesToRenderer();
  }
}
