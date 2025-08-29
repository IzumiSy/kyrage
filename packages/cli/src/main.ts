import { defineCommand, runMain } from "citty";
import * as pkg from "../package.json";
import { applyCmd } from "./commands/apply";
import { generateCmd } from "./commands/generate";
import { devCmd } from "./commands/dev";

const mainCmd = defineCommand({
  meta: {
    name: "kyrage",
    version: pkg.version,
    description: "Kysely migration CLI with declarative schema",
  },
  subCommands: {
    apply: applyCmd,
    generate: generateCmd,
    dev: devCmd,
  },
});

runMain(mainCmd);
