declare module 'cytoscape-svg' {
  // Minimal typing – enough for TS to be happy
  const plugin: (cy: any) => void;
  export default plugin;
}

