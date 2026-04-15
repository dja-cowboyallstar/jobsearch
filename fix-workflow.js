const fs = require("fs");
const f = ".github/workflows/refresh-jobs.yml";
let s = fs.readFileSync(f, "utf8");
const old = "BLOB_READ_WRITE_TOKEN: $" + "{{ secrets.BLOB_READ_WRITE_TOKEN }}";
const add = old + "\n          FIRECRAWL_API_KEY: $" + "{{ secrets.FIRECRAWL_API_KEY }}";
s = s.replace(old, add);
fs.writeFileSync(f, s);
console.log("Done. Updated env block:");
console.log(s.substring(s.indexOf("env:"), s.indexOf("run: node")));
