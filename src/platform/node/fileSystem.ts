import { layer } from "@effect/platform-node/NodeFileSystem";
import type { FileSystem, Layer } from "effect";

export const NodeFileSystemLive: Layer.Layer<FileSystem.FileSystem> = layer;
