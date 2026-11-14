#!/usr/bin/env node
import { defaultIo, runCli } from "./cli";

process.exitCode = await runCli(process.argv.slice(2), defaultIo());
