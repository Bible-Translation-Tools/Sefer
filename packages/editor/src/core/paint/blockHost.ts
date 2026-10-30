export const blockHost = (inner: HTMLElement): HTMLElement => {
  const host = document.createElement("div");
  host.className = "cm-block-host";
  host.append(inner);
  return host;
};
