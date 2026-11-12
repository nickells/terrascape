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
export const getLocalCatalogue = localCatalogue('./assets/models/catalog.json');
export const isIndexedModel = key => key.startsWith('furnimesh:') || key.startsWith('local:');
export async function getIndexedModel(key) {
  const catalogue = await (key.startsWith('local:') ? getLocalCatalogue() : getFurniMeshCatalogue());
  const asset = catalogue[key];
  if (!asset) throw new Error('This model is not in its source catalogue');
  return asset;
}

// Shared category labels prevent separate source vocabularies from splitting filters.
function categoryLabel(category) {
  const key = category.toLowerCase().trim();
  const plurals = { bed: 'Beds', table: 'Tables', tree: 'Trees', chair: 'Seating' };
  return plurals[key] || key.replace(/\b\w/g, letter => letter.toUpperCase());
}

// A source outage must not hide the other libraries. Provider callbacks also let
// tests exercise failure cases without network requests.
export async function getModelCatalogues(loadPolyHaven, loadFurniMesh = getFurniMeshCatalogue, loadLocal = async () => ({})) {
  const results = await Promise.allSettled([loadPolyHaven(), loadFurniMesh(), loadLocal()]);
  const assets = {}, unavailable = [];
  results.forEach((result, i) => {
    const source = ['Poly Haven', 'FurniMesh', 'Curated models'][i];
    if (result.status === 'rejected') { unavailable.push(source); return; }
    for (const [id, entry] of Object.entries(result.value)) {
      assets[id] = { ...entry, source: entry.source || source, curated: i > 0, categories: [...new Set((entry.categories || []).map(categoryLabel))], license: entry.license || 'CC0',
        thumbnail_url: entry.thumbnail_url || (i ? '' : `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=96&height=96`),
      };
    }
  });
  if (!Object.keys(assets).length) throw new Error('No model libraries are available. Try again shortly.');
  return { assets, unavailable };
}
