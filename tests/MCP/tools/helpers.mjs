import { Virtual } from "../../../sources/IO/Virtual.mjs";

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function snapshot(io) {
  return Object.fromEntries(io.entries);
}

export function cloneIo(files) {
  return new Virtual(files);
}

export function fixtureFiles(fixture) {
  return {
    "/template.tpl.md": fixture.template,
    "/input.md": fixture.input,
  };
}

export function toolContext(io, extra = {}) {
  return {
    io,
    root: "/",
    maxInputBytes: 1_048_576,
    ...extra,
  };
}

export function trackWrites(io) {
  const writes = [];
  const original = io.writeFileAsync.bind(io);
  io.writeFileAsync = async (path, content, options) => {
    writes.push({ path, content });
    return original(path, content, options);
  };
  return writes;
}
