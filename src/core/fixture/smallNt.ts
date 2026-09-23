import { FileSystem, Layer } from "effect";

import psalms from "../../../fixtures/small-nt/19-PSA.usfm?raw";
import philemon from "../../../fixtures/small-nt/58-PHM.usfm?raw";
import thirdJohn from "../../../fixtures/small-nt/65-3JN.usfm?raw";
import jude from "../../../fixtures/small-nt/66-JUD.usfm?raw";
import malformed from "../../../fixtures/small-nt/99-BAD.usfm?raw";
import { MemoryFileSystemLive, type MemorySeed } from "../fileSystem/memory";

export const SMALL_NT = "small-nt";

export const SMALL_NT_ROOT = "/small-nt";

const smallNtSeed = (): MemorySeed => ({
  [`${SMALL_NT_ROOT}/19-PSA.usfm`]: psalms,
  [`${SMALL_NT_ROOT}/58-PHM.usfm`]: philemon,
  [`${SMALL_NT_ROOT}/65-3JN.usfm`]: thirdJohn,
  [`${SMALL_NT_ROOT}/66-JUD.usfm`]: jude,
  [`${SMALL_NT_ROOT}/99-BAD.usfm`]: malformed,
});

export const smallNtFileNames = (): readonly string[] =>
  Object.keys(smallNtSeed())
    .map((path) => path.slice(SMALL_NT_ROOT.length + 1))
    .sort();

export const FixtureFileSystemLive: Layer.Layer<FileSystem.FileSystem> =
  MemoryFileSystemLive(smallNtSeed());
