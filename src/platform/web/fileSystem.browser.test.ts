import { fileSystemContract } from "#core/fileSystem/contract";

import { OpfsFileSystemLive } from "./fileSystem";

fileSystemContract("opfs", () => OpfsFileSystemLive);
