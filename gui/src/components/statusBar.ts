export function renderStatusBar(
  root: HTMLElement,
  status: string,
  connected: boolean,
  isError: boolean,
): void {
  root.textContent = status;
  root.classList.toggle("is-connected", connected);
  root.classList.toggle("is-error", isError);
}
