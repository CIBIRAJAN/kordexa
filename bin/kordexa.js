#!/usr/bin/env node
import { main } from "../src/cli.js";

const FOLDER_ERRORS = {
  EACCES: "Kordexa doesn't have permission to write in this folder. Try a folder you own.",
  EPERM: "Kordexa doesn't have permission to write in this folder. Try a folder you own.",
  EROFS: "This folder is read-only. Try a folder you can write to.",
  ENOSPC: "Your disk is full. Free up some space and try again."
};

main(process.argv.slice(2)).catch((error) => {
  console.error(FOLDER_ERRORS[error?.code] || error?.message || error);
  process.exitCode = 1;
});
