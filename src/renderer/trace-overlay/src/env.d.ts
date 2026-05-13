export {};

interface DebugTraceFlowResult {
  color: "red" | "green" | "blue";
  source: "overlay";
  module: string;
  detail: Record<string, unknown>;
}

declare global {
  interface Window {
    traceOverlayAPI: {
      traceFlow: (
        color: "red" | "green" | "blue",
        source: "overlay"
      ) => Promise<DebugTraceFlowResult>;
    };
  }
}
