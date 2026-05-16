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

const PAGE_TEXT_EXCERPT_MAX_CHARS = 4000;

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
      const userMessage: CoreMessage = {
        role: "user",
        content: request.message,
      };

      if (process.env.NODE_ENV === "development") {
        console.log("@@@@@@@@@ userMessage @@@@@@@@@");
        console.log(userMessage);
        console.log("@@@@@@@@@ end userMessage @@@@@@@@@");
      }

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
      "You are the user's assistant inside this browser: use the URL and page excerpt below when helpful; navigate or open URLs when needed.",
      "Use tool web_content_visit_and_inject_javascript with function-body JavaScript and return values you need; chain many tool calls in one turn until the task stalls (login, captcha, payment card entry—never type card/bank secrets—or missing data).",
      "Treat the DOM as unknown: fuzzy-match visible text and attributes; querySelector has no :contains—match innerText in JS; try iframes and shadow roots if nodes are missing; discover links with querySelectorAll('a[href]') and score by visible text/href instead of one brittle href*= substring guess; return compact diagnostics when stuck.",
      "For web search (including Google), open a results URL with the encoded query—e.g. https://www.google.com/search?q=<encodeURIComponent(query)>—never script google.com's homepage search box or assume input[name=q] exists; after navigation return location.href plus a short innerText excerpt.",
      "Do not invent URLs or facts; discover links from the live page or user. Prefer stable JSON/RSS/API feeds over brittle layout selectors when listing content.",
      "After tools, summarize factually—only ask when hard-stopped (login, captcha, payment). Forbidden mid-task: 'Would you like…?', choose-your-own-adventure menus, or listing 'next steps' as questions. If the user says pick randomly, continue for them, or confirm only at final purchase—pick one sensible visible listing/link immediately and navigate without approval loops.",
      "Prefer including links when presenting lists of items."
    ];

    if (url) {
      parts.push(`Current page URL: ${url}`);
    }

    if (pageText) {
      const maxChars = PAGE_TEXT_EXCERPT_MAX_CHARS;
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
        maxRetries: 8,
        abortSignal: undefined, // Could add abort controller for cancellation
        stopWhen: stepCountIs(40), // Shopping/search flows need many tool rounds; raise if turns truncate mid-checkout.
        tools: {
          web_content_visit_and_inject_javascript: {
            description:
              `Loads the URL in the active tab (if needed), then runs your script. ` +
              `The model does not receive page screenshots—always return structured findings from the DOM (e.g. href, innerText excerpts, arrays of candidate links) so the next step can proceed. ` +
              `One user request may require many consecutive calls—keep going through navigation, clicks, and cart without ending the turn early. ` +
              `Pass function-body code; use return to produce the result. ` +
              `For site search, when you can infer or construct a results URL with the query in the query string, load that URL directly instead of scripting the homepage search box (consent pages and SPAs often lack stable input[name=q] / type=search). ` +
              `When locating content or controls, use fuzzy strategies before exact selectors: toLowerCase + includes on innerText/textContent; substring attribute matches; document.evaluate with contains() for text; collect candidate buttons/links and score by how well their visible text matches the user's words (partial, order-agnostic). If the node is missing, search inside iframes and open shadow roots, or return a short list of field metadata (placeholder, name, aria-label) to refine the next step. ` +
              `When the goal is structured list or feed data, try the host's JSON/RSS/API surfaces if you can find or infer them before depending on fragile list markup. ` +
              `If the result is empty or wrong, adjust the script rather than repeating it unchanged. ` +
              `CSS :contains() is not supported in querySelector (that is jQuery-only)—iterate nodes and match innerText/textContent in JS instead. ` +
              `Important labels often map to relative paths (e.g. /kompass/...) that do not include brand substrings like valkompassen; collect candidate anchors as { innerText, href } or set location.href to the resolved absolute URL rather than filtering href by the wrong substring. ` +
              `After clicks or submits that navigate, always return { href: location.href, preview: document.body.innerText.slice(0, 600) } in the same script once settled (the host waits briefly after injection so URL/DOM can update). ` +
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
                await tab.settleAfterInjectedScript();
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
