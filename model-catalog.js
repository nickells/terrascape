// Small local indexes keep browsing independent of third-party catalog APIs.
// Curated FurniMesh files are served locally and fetched only when a scene needs them.
function localCatalogue(file) {
  let pending;
  return () => pending ||= fetch(new URL(file, import.meta.url))
    .then(response => {
      if (!response.ok) throw new Error('Model catalogue unavailable');
      return response.json();
    })
    .then(entries => Object.fromEntries(entries.map(entry => [entry.id, entry])))
    .catch(error => { pending = null; throw error; });
}
export const getFurniMeshCatalogue = localCatalogue('./assets/furnimesh/catalog.json');
export const isIndexedModel = key => key.startsWith('furnimesh:');
export async function getIndexedModel(key) {
  const catalogue = await getFurniMeshCatalogue();
  const asset = catalogue[key];
  if (!asset) throw new Error('This model is not in its source catalogue');
  return asset;
}

// A source outage must not hide the other libraries. Provider callbacks also let
// tests exercise failure cases without network requests.
export async function getModelCatalogues(loadPolyHaven, loadFurniMesh = getFurniMeshCatalogue) {
  const results = await Promise.allSettled([loadPolyHaven(), loadFurniMesh()]);
  const assets = {}, unavailable = [];
  results.forEach((result, i) => {
    const source = ['Poly Haven', 'FurniMesh'][i];
    if (result.status === 'rejected') { unavailable.push(source); return; }
    for (const [id, entry] of Object.entries(result.value)) {
      assets[id] = { ...entry, source, license: entry.license || 'CC0',
        thumbnail_url: entry.thumbnail_url || (i ? '' : `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=96&height=96`),
      };
    }
  });
  if (!Object.keys(assets).length) throw new Error('No model libraries are available. Try again shortly.');
  return { assets, unavailable };
}
