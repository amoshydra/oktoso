import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

// The extension is applied before the contract modules are loaded so every
// schema instance gets the .openapi() method.
extendZodWithOpenApi(z);
const { buildOpenApiDocument } = await import(
  "../packages/contracts/src/openapi"
);

const outputPath = resolve("docs/openapi.yaml");
const document = buildOpenApiDocument();
const generated = YAML.stringify(document, { lineWidth: 0 });
const check = process.argv.includes("--check");

if (check) {
  let current = "";
  try {
    current = await readFile(outputPath, "utf8");
  } catch {
    console.error(`Missing ${outputPath}. Run pnpm openapi:generate.`);
    process.exit(1);
  }
  if (current !== generated) {
    console.error(
      "docs/openapi.yaml is out of date. Run pnpm openapi:generate and commit the result.",
    );
    process.exit(1);
  }
  console.log("OpenAPI contract is up to date.");
} else {
  await writeFile(outputPath, generated, "utf8");
  console.log(`Wrote ${outputPath}`);
}
