// The unit tests' one setup file: bento's functions are module-level, started
// once at boot in the app (`WebBentoLive`), so a test that reads a manifest
// needs it started too.
import { startBento } from "./bento";

startBento();
