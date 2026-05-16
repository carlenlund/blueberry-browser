import { WebContents } from "electron";
import {
  jsonSchema,
  stepCountIs,
  streamText,
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

interface StreamChunk {
  content: string;
  isComplete: boolean;
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
          request.messageId,
          "LLM service is not configured. Please add your API key to the .env file."
        );
        return;
      }

      const { system, messages } = await this.prepareMessagesWithContext(request);
      await this.streamResponse(system, messages, request.messageId);
    } catch (error) {
      console.error("Error in LLM request:", error);
      this.handleStreamError(error, request.messageId);
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
      "Navigate to different pages if information doesnt exist on current page. E.g. if we are on google.com and user asks for 'hackernews top posts', then navigate to hackernews.com",
      "Think critically about result from tool call. Rerun tool with more general input if necessary.",
      "For web_content_javascript_inject and web_content_visit_and_inject_javascript, the script field must be function-body code that uses return to produce the value you want from the page.",
    ];

    if (url) {
      parts.push(`Current page URL: ${url}`);
    }

    return parts.join("\n");
  }

  private async streamResponse(
    system: string,
    messages: CoreMessage[],
    messageId: string
  ): Promise<void> {
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
          web_content_javascript_inject: {
            description:
              "Run JavaScript in the active tab. The script is inserted as the body of a try block inside an IIFE. Use return to pass the tool result back.",
            inputSchema: jsonSchema<{ script: string }>({
              type: "object",
              properties: {
                script: {
                  type: "string",
                  description:
                    "Function body (statements). Must end by returning the value for the tool result, e.g. return Array.from(document.querySelectorAll('a')).map(n => n.textContent).join('\\n');",
                },
              },
              required: ["script"],
            }),
            execute: async ({ script }: { script: string }) => {
              const tab = this.window?.activeTab;
              return await tab?.runExclusive(async () => {
                if (process.env.NODE_ENV === "development") {
                  console.log('@@@@@@@@@ begin web_content_javascript_inject @@@@@@@@@');
                  console.log('@@@@@@@@@ begin script @@@@@@@@@');
                  console.log(script);
                  console.log('@@@@@@@@@ end script @@@@@@@@@');
                }

                const result = await tab?.runJs(script);
                if (process.env.NODE_ENV === "development") {
                  console.log('@@@@@@@@@ result @@@@@@@@@');
                  console.log(result);
                  console.log('@@@@@@@@@ end result @@@@@@@@@');
                  console.log('@@@@@@@@@ end web_content_javascript_inject @@@@@@@@@');
                }

                return result;
              });
            }
          },
          web_content_visit_and_inject_javascript: {
            description:
              "Load url in the active tab, then run JavaScript. The script is inserted as the body of a try block inside an IIFE. Use return for the tool result.",
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
                  console.log(runResult);
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

      await this.processStream(result.textStream, messageId);
    } catch (error) {
      throw error; // Re-throw to be handled by the caller
    }
  }

  private async processStream(
    textStream: AsyncIterable<string>,
    messageId: string
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

    for await (const chunk of textStream) {
      accumulatedText += chunk;

      // Update assistant message content
      this.messages[messageIndex] = {
        role: "assistant",
        content: accumulatedText,
      };
      this.sendMessagesToRenderer();

      this.sendStreamChunk(messageId, {
        content: chunk,
        isComplete: false,
      });
    }

    // Final update with complete content
    this.messages[messageIndex] = {
      role: "assistant",
      content: accumulatedText,
    };
    this.sendMessagesToRenderer();

    // Send the final complete signal
    this.sendStreamChunk(messageId, {
      content: accumulatedText,
      isComplete: true,
    });
  }

  private handleStreamError(error: unknown, messageId: string): void {
    console.error("Error streaming from LLM:", error);

    const errorMessage = this.getErrorMessage(error);
    this.sendErrorMessage(messageId, errorMessage);
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

  private sendErrorMessage(messageId: string, errorMessage: string): void {
    this.sendStreamChunk(messageId, {
      content: errorMessage,
      isComplete: true,
    });
  }

  private sendStreamChunk(messageId: string, chunk: StreamChunk): void {
    this.webContents.send("chat-response", {
      messageId,
      content: chunk.content,
      isComplete: chunk.isComplete,
    });
  }
}
