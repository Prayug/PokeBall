// Per-species corrections for the 3D models that the general fixes in model3d.js cannot work
// out on their own. Each entry, by Pokédex number:
//   hide:  meshes to leave out, by mesh or material name (effects the export carries as part of the body:
//          Quaquaval's column of water, Skeledirge's stream of fire, Marshadow's shadow;
//          props: Conkeldurr's concrete pillars, which stood apart and held its arms out)
//   rot:   [x, y, z] radians to stand up a model exported lying down (Sawk, Quaquaval)
//   clips: false to ignore the model's own clips (Marshadow's idle throws its body out of
//          shape)
//   bones: false to drop a skeleton the skin does not match and build a new one (Buzzwole)
export const FIX = {
  534: { hide: /Cylinder/ },
  539: { rot: [0, -Math.PI / 2, 0] },
  794: { bones: false },
  802: { hide: /^Object_7$/, clips: false },
  911: { hide: /^Object_210$/ },
  914: { hide: /gel_mesh/, rot: [Math.PI / 2, 0, 0] },
};
