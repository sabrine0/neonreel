// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import type { ModelDef } from "../catalog";
import type { Generation, OutputType } from "../types";

export type CheckResult =
  | { status: "running"; progress: number }
  | { status: "done"; outputUrl: string; outputType: OutputType }
  | { status: "failed"; error: string };

export interface Provider {
  /** Start the job. Returns handles stored on the generation as `job`. */
  submit(gen: Generation, model: ModelDef): Promise<Record<string, string>>;
  /** Poll the job. Called repeatedly until it reports done or failed. */
  check(gen: Generation, model: ModelDef): Promise<CheckResult>;
}
