import { describeTemplateFunction, templateLanguage, renderTemplateReference } from "../../TemplateLanguage.mjs";

export async function handleReference(params = {}) {
  const topic = params.topic == null ? null : String(params.topic);
  const reference = topic == null ? templateLanguage : describeTemplateFunction(topic);
  if (reference == null) {
    return {
      ok: false,
      reference: null,
      errors: [{
        code: "DO_MD_USER_ERROR",
        message: `unknown template function: ${topic}`,
        file: null,
        line: 1,
        column: 1,
        snippet: null,
      }],
    };
  }
  const value = params.format && params.format !== "json"
    ? renderTemplateReference({ topic, format: params.format })
    : reference;
  return { ok: true, reference: value, errors: [] };
}
