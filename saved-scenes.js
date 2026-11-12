// Saved compositions share the same scene format as File → Open.
export const SAVED_SCENES = {
  quietcoast: {
    label: 'The Quiet Coast', pal: 'poolhall', time: 'day',
    file: './scenes/the-quiet-coast.tsc',
    description: 'A quiet island home: pale stone, warm wood, and an open wall facing the sea.',
  },
};

export async function loadSavedScene(key, fetchScene = fetch) {
  const preset = SAVED_SCENES[key];
  if (!preset) throw new Error('Unknown saved scene');
  const response = await fetchScene(new URL(preset.file, import.meta.url));
  if (!response.ok) throw new Error('Could not load the saved scene');
  const scene = await response.json();
  if (!Array.isArray(scene.objects) || !scene.camera || !scene.sky || !scene.terrain)
    throw new Error('Invalid saved scene');
  return { ...scene, scene: key };
}
