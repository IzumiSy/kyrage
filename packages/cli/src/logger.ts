import { createConsola } from "consola";

export type Logger = {
  stdout: (msg: string) => void;
  reporter: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    success: (msg: string) => void;
    log: (msg: string) => void;
    error: (error: Error | string) => void;
  };
};

const consola = createConsola({
  // Redirect console output to stderr in order not to mix it
  // with stdout to redirect planned SQL queries to a file
  stdout: process.stderr,
});

export const defaultConsolaLogger: Logger = {
  stdout: (msg) => console.log(msg),
  reporter: {
    ...consola,
  },
};

export const nullLogger: Logger = {
  stdout: () => void 0,
  reporter: {
    info: () => void 0,
    warn: () => void 0,
    success: () => void 0,
    log: () => void 0,
    error: () => void 0,
  },
};
