export const modelKeys = ["luna", "terra", "sol"] as const;
export type ModelKey = typeof modelKeys[number];
export const reasoningEfforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = typeof reasoningEfforts[number];
export type ModelSelection = { model: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol"; reasoning: ReasoningEffort };

export const modelByKey: Record<ModelKey, ModelSelection["model"]> = {
  luna: "gpt-5.6-luna",
  terra: "gpt-5.6-terra",
  sol: "gpt-5.6-sol",
};

export const defaultModelSelection: ModelSelection = { model: "gpt-5.6-terra", reasoning: "medium" };

export const isModelKey = (value: string): value is ModelKey => (modelKeys as readonly string[]).includes(value);
export const isReasoningEffort = (value: string): value is ReasoningEffort => (reasoningEfforts as readonly string[]).includes(value);
export const isModelSelection = (value: ModelSelection): boolean => Object.values(modelByKey).includes(value.model) && isReasoningEffort(value.reasoning);
export const modelName = (model: ModelSelection["model"]): string => model.endsWith("-luna") ? "Luna" : model.endsWith("-terra") ? "Terra" : "Sol";
export const modelArguments = (selection: ModelSelection): string[] => {
  if (!isModelSelection(selection)) throw new Error("Invalid model selection.");
  return ["--model", selection.model, "--config", `model_reasoning_effort="${selection.reasoning}"`];
};
