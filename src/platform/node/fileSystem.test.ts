import { fileSystemContract } from "#core/fileSystem/contract";

import { NodeFileSystemLive } from "./fileSystem";

fileSystemContract("node", () => NodeFileSystemLive);
