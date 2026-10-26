import { launchDetached } from "./platform.ts";
import { emulatorPath } from "./sdk.ts";

// Every emulator launch goes through here; how it is launched per OS is in platform.ts launchDetached.
// Returns the launcher PID; down()/killAll() match instances by their `crew-*` command line, not by this PID.
export const launchEmulator = (args: string[], log: string, window = false): Promise<number> => launchDetached(emulatorPath(), args, log, window);
