import struct, zlib, os

def create_png(width, height, r, g, b):
    """Generate a solid-color PNG and return bytes."""
    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter: none
        for x in range(width):
            raw += bytes([r, g, b, 255])

    def chunk(ctype, data):
        c = ctype + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack('>I', len(data)) + c + crc

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)

    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', ihdr) +
            chunk(b'IDAT', zlib.compress(raw)) +
            chunk(b'IEND', b''))

base = os.path.dirname(os.path.abspath(__file__))

for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png')]:
    path = os.path.join(base, name)
    png = create_png(size, size, 26, 115, 232)
    with open(path, 'wb') as f:
        f.write(png)
    print(f'Created {name} ({size}x{size})')
