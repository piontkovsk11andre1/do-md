import {
  Editor,
  Fetch,
  Virtual,
  Template,
  Writer,
  exportDoc,
  formatDiagnostic,
} from "@p10i/do-md/browser";

const element = (id) => document.getElementById(id);
const originals = new WeakMap();
let output = "";

// Textareas normalize CRLF. Keep the loaded bytes while the field is unchanged;
// precise title edits and downloads can then preserve those original endings.
function setText(field, text) {
  field.value = text;
  originals.set(field, { raw: text, displayed: field.value });
}
function readText(field) {
  const saved = originals.get(field);
  return saved?.displayed === field.value ? saved.raw : field.value;
}
function virtualProject() {
  return new Virtual({
    "document.md": readText(element("document")),
    "shape.md.template": readText(element("template")),
  });
}
function showOutput(text) {
  output = text;
  element("output").textContent = text;
  element("download").disabled = false;
}
function showData(context) {
  element("data").value = JSON.stringify(context, null, 2);
}
function showError(error) {
  element("status").textContent = "Error";
  element("diagnostic").textContent = error.locations ? formatDiagnostic(error) : error.message;
  element("locations").textContent = JSON.stringify(error.locations ?? [], null, 2);
}
async function run(operation) {
  element("diagnostic").textContent = "";
  element("locations").textContent = "";
  try {
    await operation();
  } catch (error) {
    showError(error);
  }
}
async function parse() {
  const result = await exportDoc({
    io: virtualProject(),
    file: "document.md",
    template: "shape.md.template",
  });
  if (!result.ok) {
    showError(result.errors[0]);
    return;
  }
  showData(result.context);
  showOutput(readText(element("document")));
  element("status").textContent = "Parsed in the browser";
}
async function load() {
  const io = new Fetch();
  const [source, template] = await Promise.all([
    io.readFileAsync(new URL("./document.md", location.href).href),
    io.readFileAsync(new URL("./template.md.template", location.href).href),
  ]);
  setText(element("document"), source);
  setText(element("template"), template);
  await parse();
}
element("load").addEventListener("click", () => run(load));
element("parse").addEventListener("click", () => run(parse));
element("edit").addEventListener("click", () =>
  run(async () => {
    const editor = await Editor.open({
      io: virtualProject(),
      file: "document.md",
      template: "shape.md.template",
    });
    editor.set("title", element("title").value);
    setText(element("document"), editor.render());
    showOutput(editor.render());
    showData(editor.context);
    element("status").textContent = "Precise edit applied";
  }),
);
element("render").addEventListener("click", () =>
  run(() => {
    const data = JSON.parse(element("data").value);
    const writer = new Writer(data);
    Template.wrap(readText(element("template")), "shape.md.template")(
      writer,
      data,
      data,
      {},
      virtualProject(),
    );
    showOutput(writer.toMarkdown());
    element("status").textContent = "Rendered from JSON";
  }),
);
element("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([output], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "document.md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
await run(load);
