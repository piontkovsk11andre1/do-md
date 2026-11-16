import { readFile } from "node:fs/promises";

/** Read the bundled Agent Skill without installing it or modifying agent settings. */
export function readSkill() {
  return readFile(new URL("../skills/do-md/SKILL.md", import.meta.url), "utf8");
}
