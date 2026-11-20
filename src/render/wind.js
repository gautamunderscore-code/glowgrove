// A gentle breeze. Adds a small sway to a material's vertices in the shader,
// so thousands of leaves and grass blades move for almost no cost.

export const windTime = { value: 0 };

/**
 * @param material  any MeshStandardMaterial
 * @param amount    how far things sway (metres)
 * @param mode      'tip' = sway grows toward the top of each blade (uses uv.y),
 *                  'card' = whole instanced leaf card flutters
 */
export function addWind(material, amount, mode) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 seedPos = vec3(0.0);
          #ifdef USE_INSTANCING
            seedPos = instanceMatrix[3].xyz;
          #endif
          float phase = uWindTime * 1.6 + seedPos.x * 0.7 + seedPos.z * 0.5;
          float gust = 0.6 + 0.4 * sin(uWindTime * 0.35 + seedPos.x * 0.1);
          float weight = ${mode === 'tip' ? 'uv.y * uv.y' : '1.0'};
          transformed.x += sin(phase) * ${amount.toFixed(4)} * weight * gust;
          transformed.z += cos(phase * 0.8) * ${(amount * 0.6).toFixed(4)} * weight * gust;
        }`
      );
  };
  material.customProgramCacheKey = () => `wind-${mode}-${amount}`;
  return material;
}
