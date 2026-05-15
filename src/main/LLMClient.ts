import { WebContents } from "electron";
import {
  generateText,
  type LanguageModel,
  type CoreMessage,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";
import {
  DOM_MAP_JSON_SECTION_MARKER,
  budgetTruncateDomMapUserMessage,
} from "@shared/domMapLlmBudget";
import type { FeedOverlayPageAgentInvokeResult } from "@shared/feedOverlayPageAgentPrompt";
import {
  FEED_OVERLAY_PAGE_AGENT_MAX_ITERATIONS,
  FEED_OVERLAY_PAGE_AGENT_MAX_SCRIPT_CHARS,
  buildFeedOverlayAgentUserTurn,
  feedOverlayPageAgentSystemPrompt,
  parseFeedOverlayAgentModelReply,
  resolveFeedOverlayAgentNavigateUrl,
} from "@shared/feedOverlayPageAgentPrompt";
import {
  FEED_OVERLAY_AGENT_PAGE_CONTEXT_JS,
  FEED_OVERLAY_PAGE_AGENT_SPA_SETTLE_MS,
  formatAgentPageContextForPrompt,
} from "@shared/feedOverlayAgentPageContext";
import {
  isFeedOverlayAgentScriptEnvelope,
  wrapFeedOverlayAgentUserScript,
} from "@shared/feedOverlayAgentRunScript";

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

const MAX_CONTEXT_LENGTH = 2800;
const DEFAULT_TEMPERATURE = 0.7;

function readOptionalPositiveInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Sidebar chat + DOM-map JS transform. Default is intentionally low for latency;
 * raise with `LLM_MAX_OUTPUT_TOKENS` if flatten scripts truncate on huge pages.
 */
const CHAT_MAX_OUTPUT_TOKENS = readOptionalPositiveInt(
  "LLM_MAX_OUTPUT_TOKENS",
  4096,
);

/** Feed overlay page agent (short JSON per turn). Override: `LLM_PAGE_AGENT_MAX_OUTPUT_TOKENS`. */
const PAGE_AGENT_MAX_OUTPUT_TOKENS = readOptionalPositiveInt(
  "LLM_PAGE_AGENT_MAX_OUTPUT_TOKENS",
  1536,
);

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly provider: LLMProvider;
  private readonly modelName: string;
  private readonly model: LanguageModel | null;
  private messages: CoreMessage[] = [];
  private activeStreamAbort: AbortController | null = null;

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

  /** Reject screenshots that Chromium serializes as `data:image/...base64,` with no payload (vision APIs error). */
  private isRenderableScreenshotDataUrl(url: string): boolean {
    if (!url.startsWith("data:image/")) return false;
    const i = url.indexOf("base64,");
    if (i === -1) return false;
    const b64 = url.slice(i + 7).replace(/\s/g, "");
    return b64.length >= 96;
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
      this.cancelOngoingAssistantStream();

      const truncateMessageBody = budgetTruncateDomMapUserMessage(
        request.message,
      );
      const skipScreenshotBecauseDomMapPrompt = request.message.includes(
        DOM_MAP_JSON_SECTION_MARKER,
      );

      // Get screenshot from active tab when useful (skipped for bulky DOM-map JSON prompts).
      let screenshot: string | null = null;
      if (!skipScreenshotBecauseDomMapPrompt && this.window) {
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

      const userContent: Array<
        | { type: "text"; text: string }
        | { type: "image"; image: string }
      > = [];

      if (
        screenshot &&
        this.isRenderableScreenshotDataUrl(screenshot)
      ) {
        userContent.push({
          type: "image",
          image: screenshot,
        });
      }

      userContent.push({
        type: "text",
        text: truncateMessageBody,
      });

      const userMessage: CoreMessage = {
        role: "user",
        content:
          userContent.length === 1 ? truncateMessageBody : userContent,
      };
      
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

      const messages = await this.prepareMessagesWithContext(request);
      await this.streamResponse(messages, request.messageId);
    } catch (error) {
      if (this.isAbortLikeError(error)) return;
      console.error("Error in LLM request:", error);
      this.handleStreamError(error, request.messageId);
    }
  }

  /** Stop the in-flight streamed assistant reply (navigation / quick-feed restart). */
  cancelOngoingAssistantStream(): void {
    try {
      this.activeStreamAbort?.abort();
    } catch {
      /* ignore */
    }
  }

  /**
   * Feed-overlay composer: run up to FEED_OVERLAY_PAGE_AGENT_MAX_ITERATIONS LLM turns
   * that execute page scripts and/or navigate.
   */
  async runFeedOverlayPageAgent(
    userGoal: string,
  ): Promise<FeedOverlayPageAgentInvokeResult> {
    const goal = typeof userGoal === "string" ? userGoal.trim() : "";
    if (!goal) {
      return { ok: false, error: "Empty goal" };
    }
    if (!this.model) {
      this.window?.sendFeedOverlayPageAgentStatus(
        "LLM is not configured — add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env.",
      );
      return {
        ok: false,
        error:
          "LLM service is not configured. Please add your API key to the .env file.",
      };
    }
    const win = this.window;
    if (!win) {
      return { ok: false, error: "Browser window not available" };
    }
    const tab = win.activeTab;
    if (!tab) {
      win.sendFeedOverlayPageAgentStatus("No active browser tab.");
      return { ok: false, error: "No active tab" };
    }

    this.cancelOngoingAssistantStream();

    win.sendFeedOverlayPageAgentStatus("Page agent started.");

    const trace: string[] = [];
    const system = feedOverlayPageAgentSystemPrompt();
    let lastSummary = "";

    for (let i = 0; i < FEED_OVERLAY_PAGE_AGENT_MAX_ITERATIONS; i++) {
      win.sendFeedOverlayPageAgentStatus(
        `Step ${i + 1}/${FEED_OVERLAY_PAGE_AGENT_MAX_ITERATIONS} — reading the page and calling the model…`,
      );

      const pageUrl = tab.url;
      await new Promise<void>((r) =>
        setTimeout(r, FEED_OVERLAY_PAGE_AGENT_SPA_SETTLE_MS),
      );

      let pageText = "";
      try {
        const raw = await tab.runJs(FEED_OVERLAY_AGENT_PAGE_CONTEXT_JS);
        pageText = formatAgentPageContextForPrompt(raw);
      } catch (e) {
        trace.push(`Page context script failed: ${String(e)}`);
        try {
          const fullText = await tab.getTabText();
          pageText =
            fullText.length > 8000
              ? `${fullText.slice(0, 8000)}…`
              : fullText;
        } catch (e2) {
          trace.push(`Fallback innerText failed: ${String(e2)}`);
        }
      }

      let screenshot: string | null = null;
      try {
        const image = await tab.screenshot();
        screenshot = image.toDataURL();
      } catch (e) {
        trace.push(`Screenshot failed: ${String(e)}`);
      }

      const userTurnText = buildFeedOverlayAgentUserTurn({
        goal,
        iterationIndex: i + 1,
        maxIterations: FEED_OVERLAY_PAGE_AGENT_MAX_ITERATIONS,
        pageUrl,
        pageText,
        actionLog: trace,
      });

      const userMessageContent:
        | string
        | Array<
            | { type: "text"; text: string }
            | { type: "image"; image: string }
          > =
        screenshot && this.isRenderableScreenshotDataUrl(screenshot)
          ? [
              { type: "image", image: screenshot },
              {
                type: "text",
                text:
                  "Tab viewport screenshot (above). Use it together with the structured text below — especially for news headlines, consent/cookie UI, paywalls, and when extracted text looks empty.\n\n" +
                  userTurnText,
              },
            ]
          : userTurnText;

      const messages: CoreMessage[] = [
        { role: "system", content: system },
        { role: "user", content: userMessageContent },
      ];

      let rawText: string;
      try {
        const result = await generateText({
          model: this.model,
          messages,
          temperature: 0.2,
          maxRetries: 1,
          maxOutputTokens: PAGE_AGENT_MAX_OUTPUT_TOKENS,
        });
        rawText = result.text;
      } catch (e) {
        win.sendFeedOverlayPageAgentStatus(
          `Model request failed: ${this.getErrorMessage(e)}`,
        );
        return { ok: false, error: this.getErrorMessage(e) };
      }

      let reply;
      try {
        reply = parseFeedOverlayAgentModelReply(rawText);
      } catch (e) {
        win.sendFeedOverlayPageAgentStatus(
          `Invalid model response (expected JSON). ${e instanceof Error ? e.message : String(e)}`,
        );
        return {
          ok: false,
          error: `Invalid model JSON: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      if (reply.reasoning) {
        const shortThought =
          reply.reasoning.length > 220
            ? `${reply.reasoning.slice(0, 220)}…`
            : reply.reasoning;
        win.sendFeedOverlayPageAgentStatus(`Model: ${shortThought}`);
        trace.push(`Thought: ${reply.reasoning}`);
      }

      // Terminal: nothing to execute on the tab this turn.
      if (reply.done && !reply.navigateUrl && !reply.pageScript) {
        lastSummary = reply.summary || reply.reasoning || "Done.";
        return {
          ok: true,
          summary: lastSummary,
          iterationsUsed: i + 1,
          trace,
        };
      }

      let didMutateTab = false;

      if (reply.navigateUrl) {
        const target = resolveFeedOverlayAgentNavigateUrl(
          reply.navigateUrl,
          pageUrl,
        );
        if (!target) {
          trace.push("Navigate skipped: empty URL");
          win.sendFeedOverlayPageAgentStatus("Navigate skipped (empty URL).");
        } else {
          didMutateTab = true;
          trace.push(`Navigate → ${target}`);
          win.sendFeedOverlayPageAgentStatus(`Navigating to: ${target}`);
          void tab.loadURL(target).catch((err) => {
            console.warn("[feed-overlay-agent] loadURL:", err);
          });
          await tab.waitUntilContentReady(450);
          win.sendFeedOverlayPageAgentStatus("Page loaded after navigation.");
        }
      }

      if (reply.pageScript) {
        const script = reply.pageScript;
        if (script.length > FEED_OVERLAY_PAGE_AGENT_MAX_SCRIPT_CHARS) {
          trace.push(
            `Script rejected (too long: ${script.length} chars)`,
          );
          win.sendFeedOverlayPageAgentStatus(
            `Script not run (too long: ${script.length} characters).`,
          );
        } else {
          didMutateTab = true;
          win.sendFeedOverlayPageAgentStatus("Running JavaScript in the active tab…");
          try {
            const wrapped = wrapFeedOverlayAgentUserScript(script);
            const out = await tab.runJs(wrapped);
            if (isFeedOverlayAgentScriptEnvelope(out)) {
              if (!out.ok) {
                const detail = [out.name, out.error].filter(Boolean).join(": ");
                trace.push(`Script error: ${detail}`);
                win.sendFeedOverlayPageAgentStatus(`Script error: ${detail}`);
              } else {
                const val = out.value;
                const preview =
                  typeof val === "object"
                    ? JSON.stringify(val).slice(0, 1200)
                    : String(val).slice(0, 1200);
                trace.push(`Script result: ${preview}`);
                const shortPreview =
                  preview.length > 300 ? `${preview.slice(0, 300)}…` : preview;
                win.sendFeedOverlayPageAgentStatus(
                  `Script finished. ${shortPreview}`,
                );
              }
            } else {
              const preview =
                typeof out === "object"
                  ? JSON.stringify(out).slice(0, 1200)
                  : String(out).slice(0, 1200);
              trace.push(`Script result: ${preview}`);
              const shortPreview =
                preview.length > 300 ? `${preview.slice(0, 300)}…` : preview;
              win.sendFeedOverlayPageAgentStatus(
                `Script finished. ${shortPreview}`,
              );
            }
          } catch (e) {
            trace.push(`Script error: ${String(e)}`);
            win.sendFeedOverlayPageAgentStatus(`Script error: ${String(e)}`);
          }
        }
      }

      if (reply.done) {
        lastSummary = reply.summary || reply.reasoning || "Done.";
        trace.push("Agent marked done after this turn’s actions.");
        return {
          ok: true,
          summary: lastSummary,
          iterationsUsed: i + 1,
          trace,
        };
      }

      if (didMutateTab) {
        continue;
      }

      lastSummary =
        reply.summary ||
        reply.reasoning ||
        "No further action returned; treating as complete.";
      trace.push("No navigateUrl or pageScript.");
      return {
        ok: true,
        summary: lastSummary,
        iterationsUsed: i + 1,
        trace,
      };
    }

    win.sendFeedOverlayPageAgentStatus(
      `Stopped after ${FEED_OVERLAY_PAGE_AGENT_MAX_ITERATIONS} steps (limit).`,
    );
    return {
      ok: true,
      summary:
        lastSummary ||
        `Stopped after ${FEED_OVERLAY_PAGE_AGENT_MAX_ITERATIONS} iterations.`,
      iterationsUsed: FEED_OVERLAY_PAGE_AGENT_MAX_ITERATIONS,
      trace,
    };
  }

  clearMessages(): void {
    this.cancelOngoingAssistantStream();
    this.messages = [];
    this.sendMessagesToRenderer();
  }

  getMessages(): CoreMessage[] {
    return this.messages;
  }

  private sendMessagesToRenderer(): void {
    this.webContents.send("chat-messages-updated", this.messages);
  }

  private async prepareMessagesWithContext(
    request: ChatRequest,
  ): Promise<CoreMessage[]> {
    // Get page context from active tab
    let pageUrl: string | null = null;
    let pageText: string | null = null;

    const skipPageTextBecauseDomMap = request.message.includes(
      DOM_MAP_JSON_SECTION_MARKER,
    );

    if (this.window) {
      const activeTab = this.window.activeTab;
      if (activeTab) {
        pageUrl = activeTab.url;
        if (!skipPageTextBecauseDomMap) {
          try {
            pageText = await activeTab.getTabText();
          } catch (error) {
            console.error("Failed to get page text:", error);
          }
        }
      }
    }

    // Build system message
    const systemMessage: CoreMessage = {
      role: "system",
      content: this.buildSystemPrompt(pageUrl, pageText),
    };

    // Include all messages in history (system + conversation)
    return [systemMessage, ...this.messages];
  }

  private buildSystemPrompt(url: string | null, pageText: string | null): string {
    const parts: string[] = [
      "You are a helpful AI assistant integrated into a web browser.",
      "You can analyze and discuss web pages with the user.",
      "The user's messages may include an optional screenshot of the current browser tab (not sent for large DOM-map JSON prompts).",
    ];

    if (url) {
      parts.push(`\nCurrent page URL: ${url}`);
    }

    if (pageText) {
      const truncatedText = this.truncateText(pageText, MAX_CONTEXT_LENGTH);
      parts.push(`\nPage content (text):\n${truncatedText}`);
    }

    parts.push(
      "\nPlease provide helpful, accurate, and contextual responses about the current webpage.",
      "If the user asks about specific content, refer to the page content and/or screenshot provided."
    );

    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private isAbortLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (error.name === "AbortError") return true;
    const msg = error.message.toLowerCase();
    return msg.includes("aborted") || msg.includes("cancel");
  }

  /** One-shot assistant reply (layout / chat). Sidebar UI reads `chat-messages-updated`; streaming token chunks are unnecessary for short replies. */
  private async streamResponse(
    messages: CoreMessage[],
    messageId: string,
  ): Promise<void> {
    if (!this.model) {
      throw new Error("Model not initialized");
    }

    const ac = new AbortController();
    this.activeStreamAbort = ac;

    try {
      const result = await generateText({
        model: this.model,
        messages,
        temperature: DEFAULT_TEMPERATURE,
        maxRetries: 1,
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
        abortSignal: ac.signal,
      });

      if (ac.signal.aborted) {
        throw new DOMException("aborted", "AbortError");
      }

      const fullText = result.text;
      this.messages.push({
        role: "assistant",
        content: fullText,
      });
      this.sendMessagesToRenderer();

      this.sendStreamChunk(messageId, {
        content: fullText,
        isComplete: true,
      });
    } catch (error) {
      if (this.isAbortLikeError(error)) {
        return;
      }
      throw error;
    } finally {
      if (this.activeStreamAbort === ac) {
        this.activeStreamAbort = null;
      }
    }
  }

  private handleStreamError(error: unknown, messageId: string): void {
    console.error("Error completing LLM reply:", error);

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
