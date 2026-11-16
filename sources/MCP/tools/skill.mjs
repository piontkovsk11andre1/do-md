import { readSkill } from "../../Skill.mjs";

export async function handleSkill() {
  return { ok: true, skill: await readSkill(), errors: [] };
}
