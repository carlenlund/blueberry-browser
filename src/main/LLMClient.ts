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
  openai: "gpt-4o",
  anthropic: "claude-3-5-sonnet-20241022",
};

const DEFAULT_TEMPERATURE = 0.3;

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

  private buildSystemPrompt(url: string | null, pageText: string | null): string {
    const parts: string[] = [
      "You are a helpful assistant inside a web browser; the user can analyze and discuss pages with you.",
      "Use the current tab URL and the page excerpt below when they help; navigate or open another URL when the user asks or the answer is not here.",
      "You can run scripts in the page via web_content_visit_and_inject_javascript: pass function-body JavaScript and use return to send back the value you need.",
      "Treat each page as unknown: base selectors and clicks on what you see in excerpts and tool results; if something fails or is empty, try a different approach instead of repeating the same script.",
      "When finding elements or text, prefer fuzzy matching: case-insensitive and partial matches (e.g. includes, normalize whitespace), attribute substring selectors ([href*=\"...\"], [placeholder*=\"...\"], [aria-label*=\"...\"]; in Chromium you may use the i flag on attribute selectors for case-insensitivity), XPath contains(), walking clickable nodes and picking the closest label to the user's phrase; if exact wording fails, try shorter substrings, synonyms, or alternate spellings before giving up.",
      "If querySelector returns null, the control may be in an iframe (iterate iframes and query iframe.contentDocument when allowed) or in a shadow root (host.shadowRoot); failing that, return a compact diagnostic: list inputs/buttons with tagName, type, placeholder, name, id, aria-label (cap ~40) so the next script can fuzzy-match.",
      "On search homepages, consent or overlay dialogs can block the query box—try visible textarea/input near the top of the tree, [name=q], [type=search], or dismissing common consent buttons before assuming the selector is wrong.",
      "When interacting with the page, prefer matching visible labels and avoid one-off generic selectors that might hit browser chrome; do not submit forms or post content unless the user clearly wants that.",
      "Do not invent URLs or facts; briefly confirm the page matches the task before summarizing; ask the user if critical context is missing.",
      "Find page URLs by checking results on Google Search. Don't use remembered page URLs.",
      "When the user asks to search the web or \"Google\" something, prefer navigating with web_content_visit_and_inject_javascript to https://www.google.com/search?q= plus encodeURIComponent(...) for the query terms instead of typing into google.com's homepage. Cookie/consent interstitials and regional shells often omit input[name=q], which makes homepage scripting unreliable.",
      "After navigating to a search results URL, use return with location.href and a short snippet of document.body.innerText (or similar) so you can verify results loaded before replying."
    ];

    if (url) {
      parts.push(`Current page URL: ${url}`);
    }

    if (pageText) {
      const maxChars = 8000;
      const excerpt =
        pageText.length > maxChars
          ? `${pageText.slice(0, maxChars)}\n...[page text truncated]`
          : pageText;
      parts.push(
        "Current page rendered text excerpt (buttons and labels appear here alongside links; truncated if long):\n" +
          excerpt
      );
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
        stopWhen: stepCountIs(16), // NOTE(Carl): Arbitrary limit so we have enough steps for processing data and navigating.
        tools: {
          web_content_visit_and_inject_javascript: {
            description:
              `Loads the URL in the active tab (if needed), then runs your script. ` +
              `Pass function-body code; use return to produce the result. ` +
              `For Google web searches, load https://www.google.com/search?q=<encoded query> directly rather than scripting the google.com homepage search box—consent pages often lack input[name=q]. ` +
              `When locating content or controls, use fuzzy strategies before exact selectors: toLowerCase + includes on innerText/textContent; substring attribute matches; document.evaluate with contains() for text; collect candidate buttons/links and score by how well their visible text matches the user's words (partial, order-agnostic). If the node is missing, search inside iframes and open shadow roots, or return a short list of field metadata (placeholder, name, aria-label) to refine the next step. ` +
              `If the result is empty or wrong, adjust the script rather than repeating it unchanged. ` +
              `Omitting return yields scriptCompletedWithoutReturn—follow with a short script that returns evidence (e.g. href or a text excerpt).`,
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
                    "Function body (statements). Must return the tool result, e.g. return document.documentElement.innerText;. After form submit or login clicks, return evidence (e.g. return { href: location.href, preview: document.body.innerText.slice(0, 800) };) so the outcome is verifiable.",
                },
              },
              required: ["url", "script"],
            }),
            execute: async ({ url, script }: { url: string, script: string }) => {
              const tab = this.window?.activeTab;
              return await tab?.runExclusive(async () => {
                if (!tab) {
                  return undefined;
                }

                if (process.env.NODE_ENV === "development") {
                  console.log('@@@@@@@@@ begin web_content_visit_and_inject_javascript @@@@@@@@@');
                  console.log('@@@@@@@@@ begin script @@@@@@@@@');
                  console.log(script);
                  console.log('@@@@@@@@@ end script @@@@@@@@@');
                }

                const alreadyOnPage = tab.url === url;
                if (!alreadyOnPage) {
                  await tab.loadURL(url);
                  await tab.settleAfterNavigation(500);
                }

                let runResult = await tab.runJs(script);
                if (runResult === undefined) {
                  runResult = {
                    scriptCompletedWithoutReturn: true,
                    urlAfterRun: tab.url ?? null,
                    hint: "Script ran with no return value. Return location.href or a short innerText excerpt in a follow-up call to confirm login or errors.",
                  };
                }
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
    const assistantMsgIndex = this.messages.length;

    this.messages.push({
      role: "assistant",
      content: "",
    });

    for await (const chunk of fullStream) {
      if (chunk.type === "text-delta") {
        const slot = this.messages[assistantMsgIndex];
        const prev =
          slot?.role === "assistant" && typeof slot.content === "string"
            ? slot.content
            : "";
        this.messages[assistantMsgIndex] = {
          role: "assistant",
          content: prev + chunk.text,
        };
        this.sendMessagesToRenderer();
      }
    }

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
