import { run } from "./run.js";

run(process.argv.slice(2)).then(
    (code) => {
        process.exitCode = code;
    },
    (err) => {
        process.stderr.write(`Unexpected error: ${(err as Error).stack ?? err}\n`);
        process.exitCode = 1;
    },
);
