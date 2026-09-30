/**
 * The canon as the workspace shows it, and what a project calls each book.
 *
 * The table lives in core (`core/location/canon.ts`) because a canon is Bible
 * data; reading what somebody typed is `core/location/citation.ts`, reached
 * through the shell's location service (`app/location.ts`). `bookName`, the
 * join of a project's metadata into a name, is in core beside the canon since
 * a finding's message names a book too; the workspace reads all three here.
 */

import { bookName, CANON, testamentOf, type Testament } from "#core/location/canon";

export { bookName, CANON, testamentOf };
export type { Testament };
