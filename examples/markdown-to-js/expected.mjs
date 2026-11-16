// Generated from the parsed document; do-md does not execute this file.
const title = "Work inventory";
const rows = [["Maintenance","2"],["Features","3"]];
const total = rows.reduce((sum, [, count]) => sum + Number(count), 0);
console.log(JSON.stringify({ title, total }));
