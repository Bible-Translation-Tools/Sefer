/**
 * A message not yet said: `m.some_id` itself, not `m.some_id()`. A table of copy holds these,
 * never strings, because the interface language can change while the app runs.
 */
export type Message = () => string;
