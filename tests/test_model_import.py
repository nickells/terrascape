import importlib.util
import json
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location('model_import', Path(__file__).resolve().parents[1]/'scripts/import_furnimesh.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportTests(unittest.TestCase):
    def test_public_download_and_title_are_extracted(self):
        result = module.parse_model_page('''
          <h1>Curved Cream Sofa 3D Model</h1>
          <meta property="og:image" content="https://example.com/sofa.png">
          <h2>Free download</h2>
          <a href="https://storage.googleapis.com/furnimesh-3d/gbl-files/sofa.glb">GLB</a>
        ''')
        self.assertEqual(result['name'], 'Curved Cream Sofa')
        self.assertTrue(result['download_url'].endswith('/sofa.glb'))
        self.assertEqual(result['thumbnail_url'], 'https://example.com/sofa.png')

    def test_account_only_and_unrelated_links_are_rejected(self):
        with self.assertRaises(ValueError):
            module.parse_model_page('<h1>Paid sofa</h1><a href="/signup">Download GLB</a>')
        with self.assertRaises(ValueError):
            module.parse_model_page('<a href="https://example.com/private.glb">GLB</a>')

    def test_preparation_preserves_geometry_and_fixes_buffer_alignment(self):
        geometry = struct.pack('<fffffffff', 0,0,0, 1,0,0, 0,1,0)
        model = {'asset':{'version':'2.0'}, 'buffers':[{'byteLength':len(geometry)}],
                 'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(geometry)}],
                 'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3'}],
                 'meshes':[{'primitives':[{'attributes':{'POSITION':0}}]}]}
        encoded = json.dumps(model).encode()
        encoded += b' ' * (-len(encoded)%4)
        source = (struct.pack('<III',0x46546c67,2,28+len(encoded)+len(geometry))
                  + struct.pack('<II',len(encoded),0x4e4f534a)+encoded
                  + struct.pack('<II',len(geometry),0x004e4942)+geometry)
        output, triangles = module.prepare_glb(source, texture_size=None)
        packed, binary = module.unpack_glb(output)
        self.assertEqual(triangles, 1)
        self.assertEqual(binary[:len(geometry)], geometry)
        self.assertEqual(packed['bufferViews'][0]['byteOffset']%4, 0)
        with self.assertRaises(ValueError): module.unpack_glb(output[:-1])


if __name__ == '__main__': unittest.main()
