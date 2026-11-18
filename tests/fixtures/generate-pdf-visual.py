#!/usr/bin/env python3
"""Build a tiny two-page PDF whose sales code exists only as pixels on page 2."""
from pathlib import Path
import zlib
from PIL import Image, ImageDraw, ImageFont

FACT = 'ORBIT-SALES-904'
VALUE = 'Q4 units: 42'
CAPTION = 'Page 1 caption. The sales code is not written in the text layer. See the chart on page 2.'

def chart() -> bytes:
    img = Image.new('RGB', (800, 500), (255, 255, 255))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 36)
        small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 24)
    except OSError:
        font = ImageFont.load_default()
        small = font
    d.rectangle((40, 40, 760, 460), outline=(20, 20, 20), width=3)
    d.text((60, 60), FACT, fill=(16, 16, 16), font=font)
    d.rectangle((60, 200, 60 + 20 * 42, 300), fill=(20, 90, 180))
    d.text((60, 320), VALUE, fill=(16, 16, 16), font=small)
    d.text((60, 400), 'Units (chart only)', fill=(80, 80, 80), font=small)
    return zlib.compress(img.tobytes(), 9)

def pdf(image: bytes) -> bytes:
    # Object graph: 1 catalog, 2 pages tree, 3 page1, 4 page2, 5 font, 6 image, 7 c1, 8 c2
    p1 = f'BT /F1 12 Tf 50 720 Td ({CAPTION}) Tj ET'.encode()
    p2 = b'q 540 0 0 337.5 36 300 cm /Im1 Do Q'
    def obj(n: int, body: bytes) -> bytes:
        return f'{n} 0 obj\n'.encode() + body + b'\nendobj\n'
    objects = [
        obj(1, b'<< /Type /Catalog /Pages 2 0 R >>'),
        obj(2, b'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 612 792] >>'),
        obj(3, b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>'),
        obj(4, b'<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 6 0 R >> >> /Contents 8 0 R >>'),
        obj(5, b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
        obj(6, b'<< /Type /XObject /Subtype /Image /Width 800 /Height 500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ' + str(len(image)).encode() + b' >>\nstream\n' + image + b'\nendstream'),
        obj(7, b'<< /Length ' + str(len(p1)).encode() + b' >>\nstream\n' + p1 + b'\nendstream'),
        obj(8, b'<< /Length ' + str(len(p2)).encode() + b' >>\nstream\n' + p2 + b'\nendstream'),
    ]
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = [0]
    for o in objects:
        offsets.append(len(out))
        out.extend(o)
    xref = len(out)
    out.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for off in offsets[1:]:
        out.extend(f'{off:010d} 00000 n \n'.encode())
    out.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return bytes(out)

def main() -> None:
    dest = Path(__file__).with_name('pdf-visual.pdf')
    dest.write_bytes(pdf(chart()))
    print(dest, dest.stat().st_size)

if __name__ == '__main__':
    main()
