export interface ScriptScene {
  prompt: string;
  narration: string;
  /** The main character appears in this scene. */
  withCharacter: boolean;
}

export interface Script {
  title: string;
  character: string;
  style: string;
  scenes: ScriptScene[];
}

const HEADER = /^(title|character|style)\s*:\s*(.*)$/i;

/**
 * Parses a pasted story script.
 *
 *   Title: The Last Spring
 *   Character: a young man with ... and a young woman with ...
 *   Style: cinematic 35mm film
 *   1. What is visible in the scene || What is said over it
 *   ~ A scene without the main character || Narration
 *
 * One scene per line. "||" separates picture from voice; a leading "~" marks
 * a scene the main character is not in. Numbering is optional.
 */
export function parseScript(text: string): Script {
  const script: Script = { title: "", character: "", style: "", scenes: [] };
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;

    const header = HEADER.exec(line);
    if (header) {
      script[header[1].toLowerCase() as "title" | "character" | "style"] = header[2].trim();
      continue;
    }

    line = line.replace(/^\d+\s*[.)]\s*/, "");
    const withCharacter = !line.startsWith("~");
    if (!withCharacter) line = line.slice(1).trim();

    const split = line.indexOf("||");
    const prompt = (split >= 0 ? line.slice(0, split) : line).trim();
    const narration = split >= 0 ? line.slice(split + 2).trim() : "";
    if (prompt) script.scenes.push({ prompt, narration, withCharacter });
  }
  return script;
}
