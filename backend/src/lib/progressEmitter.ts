export type ProgressEventType =
  | "status"
  | "narrative"
  | "plan"
  | "writing"
  | "deleted"
  | "created"
  | "quality"
  | "code_chunk"
  | "done"
  | "error";

export interface ProgressEvent {
  type: ProgressEventType;
  message: string;
  data?: Record<string, unknown>;
}

export type ProgressCallback = (event: ProgressEvent) => void;
