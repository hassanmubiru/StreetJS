import { run } from "node:test";
import { spec } from "node:test/reporters";

const stream = run({ files: ["./dist/tests/proxy.test.js"] });
stream.compose(spec).pipe(process.stdout);

stream.on("test:fail", (d) => console.error("FAIL:", d.name));

const done = () => {
  setTimeout(() => {
    const handles = process._getActiveHandles();
    const requests = process._getActiveRequests();
    console.error("\n=== ACTIVE HANDLES:", handles.length, "REQUESTS:", requests.length, "===");
    for (const h of handles) {
      console.error("  handle:", h.constructor?.name, h.remotePort ?? h.localPort ?? "");
    }
    process.exit(0);
  }, 1000);
};
stream.on("end", () => { console.error("\n=== stream end ==="); done(); });
