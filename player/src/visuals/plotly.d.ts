declare module 'plotly.js-dist-min' {
  const Plotly: {
    react(
      node: HTMLElement,
      data: Record<string, unknown>[],
      layout: Record<string, unknown>,
      config: Record<string, unknown>,
    ): Promise<unknown>;
    purge(node: HTMLElement): void;
    Plots: { resize(node: HTMLElement): void };
  };
  export default Plotly;
}
