import { readFile } from "node:fs/promises";
import { MarkpdfClient, MarkpdfError } from "@markpdf/sdk";

const client = new MarkpdfClient({ apiKey: process.env.MARKPDF_API_KEY });

async function main() {
  const data = await readFile("report.pdf");
  try {
    const markdown = await client.convertFile(data, "report.pdf", { mode: "fast" });
    console.log(markdown);
  } catch (err) {
    if (err instanceof MarkpdfError) {
      console.error(`Conversion failed (${err.statusCode}): ${err.message}`);
    } else {
      throw err;
    }
  }
}

main();
