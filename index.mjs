import * as core from "@actions/core";
import { run } from "./install.mjs";

run().catch((err) => core.setFailed(err.message));
