import { WebContents } from "electron";
import { streamText, type LanguageModel, type CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";

dotenv.config({ path: join(__dirname, "../../.env") });

interface ChatRequest {
  message: string;
  messageId: string;
}

interface StreamChunk {
  content: string;
  isComplete: boolean;
}

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const MAX_CONTEXT_LENGTH = 4000;
const DEFAULT_TEMPERATURE = 0.7;

function pageScreenshotEnabled(): boolean {
  const v = process.env.USE_PAGE_SCREENSHOT?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly modelName: string;
  private readonly model: LanguageModel | null;
  private messages: CoreMessage[] = [];

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    const apiKey = process.env.OPENAI_API_KEY;
    this.modelName = process.env.LLM_MODEL || DEFAULT_OPENAI_MODEL;
    this.model = apiKey ? openai(this.modelName) : null;
    this.logInitializationStatus();
  }

  setWindow(window: Window): void {
    this.window = window;
  }

  private logInitializationStatus(): void {
    if (this.model) {
      console.log(
        `✅ LLM Client initialized (OpenAI) using model: ${this.modelName}`
      );
    } else {
      console.error(
        "❌ LLM Client initialization failed: OPENAI_API_KEY not found.\n" +
          "Add your API key to the .env file in the project root."
      );
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      let screenshot: string | null = null;
      if (pageScreenshotEnabled() && this.window) {
        const activeTab = this.window.activeTab;
        if (activeTab) {
          try {
            const image = await activeTab.screenshot();
            screenshot = image.toDataURL();
          } catch (error) {
            console.error("Failed to capture screenshot:", error);
          }
        }
      }

      const userMessage: CoreMessage = {
        role: "user",
        content: screenshot
          ? [
              { type: "image" as const, image: screenshot },
              { type: "text" as const, text: request.message },
            ]
          : request.message,
      };

      this.messages.push(userMessage);

      this.sendMessagesToRenderer();

      if (!this.model) {
        this.sendErrorMessage(
          request.messageId,
          "LLM service is not configured. Add OPENAI_API_KEY to the .env file."
        );
        return;
      }

      const messages = await this.prepareMessagesWithContext();
      await this.streamResponse(messages, request.messageId);
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

  private async prepareMessagesWithContext(): Promise<CoreMessage[]> {
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

    const systemMessage: CoreMessage = {
      role: "system",
      content: this.buildSystemPrompt(pageUrl, pageText),
    };

    return [systemMessage, ...this.messages];
  }

  private buildSystemPrompt(url: string | null, pageText: string | null): string {
    const parts: string[] = [
      "You are a helpful AI assistant integrated into a web browser (Blueberry).",
      "The user is building/testing this browser locally. Any JavaScript you output is shown to them first; they must click an explicit Confirm button before it runs in their own tab (sandboxed page context).",
      "Your role is to help with DOM inspection, accessibility-style summaries, and safe read-only page understanding unless the user clearly approves a small, reversible edit.",
      "The user may ask you to inspect or reason about the current page.",
      "",
      "## Page probe mode (required for every reply)",
      "Your entire reply MUST be exactly ONE markdown fenced code block labeled javascript or js.",
      "Inside the fence, output a single script that runs in the page context (browser tab) via executeJavaScript.",
      "Blueberry wraps your fenced code in a function before injection, so you SHOULD use a final `return` with a JSON-serializable value (object, array, string, number, boolean, or null).",
      "The script runs ONLY inside the loaded webpage: use document and normal DOM APIs. Never reference sidebarAPI, ipcRenderer, Electron, require, or Node—those do not exist in the page and will throw.",
      "Do not put any text outside the fenced block—no prose before or after the fence.",
      "Keep the script small and readable. Prefer querySelector / querySelectorAll and explicit steps.",
      "If the user asks for multi-step navigation, return structured data for this round (e.g. candidate links); the user will confirm running your script, then paste the printed result back to continue.",
    ];

    if (url) {
      parts.push(`\nCurrent page URL: ${url}`);
    }

    if (pageText) {
      const truncatedText = this.truncateText(pageText, MAX_CONTEXT_LENGTH);
      parts.push(`\nPage content (plain text, truncated):\n${truncatedText}`);
    }

    if (pageScreenshotEnabled()) {
      parts.push(
        "\nA screenshot of the page may be attached to the user's message when enabled."
      );
    }

    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private async streamResponse(
    messages: CoreMessage[],
    messageId: string
  ): Promise<void> {
    if (!this.model) {
      throw new Error("Model not initialized");
    }

    try {
      const result = await streamText({
        model: this.model,
        messages,
        temperature: DEFAULT_TEMPERATURE,
        maxRetries: 3,
        abortSignal: undefined,
      });

      await this.processStream(result.textStream, messageId);
    } catch (error) {
      console.error("Error streaming from LLM:", error);
      this.handleStreamError(error, messageId);
    }
  }

  private async processStream(
    textStream: AsyncIterable<string>,
    messageId: string
  ): Promise<void> {
    let accumulatedText = "";

    const assistantMessage: CoreMessage = {
      role: "assistant",
      content: "",
    };

    const messageIndex = this.messages.length;
    this.messages.push(assistantMessage);

    for await (const chunk of textStream) {
      accumulatedText += chunk;

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

    this.messages[messageIndex] = {
      role: "assistant",
      content: accumulatedText,
    };
    this.sendMessagesToRenderer();

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
      return "Authentication error: Please check OPENAI_API_KEY in the .env file.";
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
