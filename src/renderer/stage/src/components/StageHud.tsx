import React from "react";
import { ArrowUp, PanelRight, PanelRightClose } from "lucide-react";

export const StageEmptyHint: React.FC = () => (
  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-sm text-[rgb(var(--muted-foreground))]">
    Visit a page to populate the stage
  </div>
);

export const StagePromptBar: React.FC<{
  promptInputRef: React.RefObject<HTMLInputElement | null>;
  prompt: string;
  onPromptChange: (value: string) => void;
  onPromptKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPromptFocus: () => void;
  onPromptBlur: () => void;
  onSubmit: () => void;
  disabled: boolean;
  sendDisabled: boolean;
}> = ({
  promptInputRef,
  prompt,
  onPromptChange,
  onPromptKeyDown,
  onPromptFocus,
  onPromptBlur,
  onSubmit,
  disabled,
  sendDisabled,
}) => (
  <div className="absolute bottom-4 left-1/2 z-10 flex w-[min(32rem,calc(100%-6rem))] -translate-x-1/2 items-center gap-1 rounded-2xl border border-gray-400 bg-[rgb(var(--background))]/92 p-1 shadow-lg backdrop-blur-sm">
    <input
      ref={promptInputRef}
      type="text"
      value={prompt}
      onChange={(e) => onPromptChange(e.target.value)}
      onKeyDown={onPromptKeyDown}
      onFocus={onPromptFocus}
      onBlur={onPromptBlur}
      placeholder="Ask the agent…"
      disabled={disabled}
      className="min-w-0 flex-1 rounded-xl bg-transparent py-3 pl-4 pr-2 text-sm text-[rgb(var(--foreground))] placeholder:text-[#888] outline-none disabled:opacity-40"
      aria-label="Prompt"
    />
    <button
      type="button"
      onClick={onSubmit}
      disabled={sendDisabled}
      aria-label="Send message"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black text-white transition hover:opacity-80 disabled:pointer-events-none disabled:opacity-50"
    >
      <ArrowUp className="size-5" aria-hidden />
    </button>
  </div>
);

export const StageMiningButton: React.FC<{
  miningEnabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}> = ({ miningEnabled, disabled, onToggle }) => (
  <button
    type="button"
    aria-label={miningEnabled ? "Disable mining" : "Enable mining"}
    title={miningEnabled ? "Disable mining" : "Enable mining"}
    disabled={disabled}
    className={`absolute bottom-4 left-4 z-10 flex h-11 w-11 items-center justify-center rounded-xl border shadow-md backdrop-blur-sm transition disabled:pointer-events-none disabled:opacity-40 ${
      miningEnabled
        ? "border-red-600 bg-red-500 text-white hover:bg-red-400"
        : "border-[rgb(var(--border))] bg-[rgb(var(--background))]/90 text-[rgb(var(--foreground))] hover:bg-[rgb(var(--muted))]"
    }`}
    onClick={onToggle}
  >
    <span aria-hidden>⛏</span>
  </button>
);

export const StageSidebarToggle: React.FC<{
  sidebarOpen: boolean;
  onToggle: () => void;
}> = ({ sidebarOpen, onToggle }) => (
  <button
    type="button"
    aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
    title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
    className="absolute bottom-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))]/90 text-[rgb(var(--foreground))] shadow-md backdrop-blur-sm transition hover:bg-[rgb(var(--muted))]"
    onClick={onToggle}
  >
    {sidebarOpen ? (
      <PanelRightClose className="size-5" aria-hidden />
    ) : (
      <PanelRight className="size-5" aria-hidden />
    )}
  </button>
);
