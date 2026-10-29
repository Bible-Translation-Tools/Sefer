import { m } from "#app/paraglide/messages";

/** What a reader calls a line's marker, as a message each: read when shown, so a language change shows. */
const NAMES: Readonly<Record<string, () => string>> = {
  p: () => m.block_name_p(),
  pi: () => m.block_name_pi(),
  m: () => m.block_name_m(),
  nb: () => m.block_name_nb(),
  q: () => m.block_name_q(),
  q1: () => m.block_name_q1(),
  q2: () => m.block_name_q2(),
  q3: () => m.block_name_q3(),
  q4: () => m.block_name_q4(),
  d: () => m.block_name_d(),
  s: () => m.block_name_s(),
  s1: () => m.block_name_s1(),
  s2: () => m.block_name_s2(),
  s3: () => m.block_name_s3(),
  s4: () => m.block_name_s4(),
  r: () => m.block_name_r(),
  li: () => m.block_name_li(),
  li1: () => m.block_name_li(),
  li2: () => m.block_name_li(),
  li3: () => m.block_name_li(),
  ip: () => m.block_name_ip(),
  iq: () => m.block_name_iq(),
};

export const nameBlock = (marker: string): string => NAMES[marker]?.() ?? `\\${marker}`;
