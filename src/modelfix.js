// Per-species corrections for the 3D models that the general fixes in model3d.js cannot work
// out on their own. Each entry, by Pokédex number:
//   hide:  meshes to leave out, by name (effects the export carries as part of the body:
//          Quaquaval's column of water, Skeledirge's stream of fire, Marshadow's shadow)
//   rot:   [x, y, z] radians to stand up a model exported lying down
export const FIX = {
  802: { hide: /^Object_7$/, clips: false },
  911: { hide: /^Object_210$/ },
  539: { rot: [0, -Math.PI / 2, 0] },
  914: { hide: /gel_mesh/, rot: [Math.PI / 2, 0, 0] },
};
