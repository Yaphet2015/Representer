"""Rebuild pdf-spacing.pdf (no third-party libs). Mid-word font changes flush PDF.js items."""
from pathlib import Path

HEL = {' ': 278, 'A': 667, 'C': 722, 'D': 722, 'E': 667, 'G': 778, 'I': 278, 'K': 667, 'L': 556, 'M': 833, 'N': 722, 'O': 778, 'P': 667, 'R': 722, 'S': 667, 'T': 611, 'W': 944, 'a': 556, 'c': 500, 'd': 556, 'e': 556, 'i': 222, 'k': 500, 'l': 222, 'm': 833, 'n': 556, 'o': 556, 'p': 556, 'r': 333, 's': 500, 't': 278, 'u': 556, 'v': 500, 'w': 722, 'x': 500, 'y': 500, ':': 278, '9': 556, '-': 333}
TIM = {' ': 250, 'A': 722, 'C': 722, 'D': 722, 'E': 611, 'G': 778, 'I': 333, 'K': 778, 'L': 611, 'M': 889, 'N': 722, 'O': 722, 'P': 556, 'R': 722, 'S': 556, 'T': 611, 'W': 944, 'a': 444, 'c': 444, 'd': 500, 'e': 444, 'i': 278, 'k': 500, 'l': 278, 'm': 778, 'n': 500, 'o': 500, 'p': 500, 'r': 333, 's': 389, 't': 278, 'u': 500, 'v': 500, 'w': 722, 'x': 500, 'y': 500, ':': 278, '9': 500, '-': 333}

def width(s, metrics, size=12):
    return sum(metrics[ch] for ch in s) * size / 1000.0

ops = ['BT']

def show_at(font, x, y, s):
    ops.append(f'/{font} 12 Tf')
    ops.append(f'1 0 0 1 {x:.3f} {y:.3f} Tm')
    esc = s.replace('\\', r'\\').replace('(', r'\(').replace(')', r'\)')
    ops.append(f'({esc}) Tj')

x, y = 48.0, 780.0
show_at('F1', x, y, 'tradema')
x += width('tradema', HEL) + 0.5
show_at('F2', x, y, 'rks')
x += width('rks', TIM) + 8
show_at('F1', x, y, 'MARK-KERN')

x, y = 48.0, 750.0
show_at('F1', x, y, 're')
x += width('re', HEL) + 0.5
show_at('F2', x, y, 'sp')
x += width('sp', TIM) + 0.5
show_at('F1', x, y, 'ective')
x += width('ective', HEL) + 4.0
show_at('F1', x, y, 'trade')
x += width('trade', HEL) + 0.5
show_at('F2', x, y, 'na')
x += width('na', TIM) + 0.5
show_at('F1', x, y, 'mes')
x += width('mes', HEL) + 8
show_at('F1', x, y, 'MARK-WORD')

show_at('F1', 48.0, 720.0, 'already spaced words MARK-PRESERVE')
show_at('F1', 48.0, 650.0, 'L9: method A')
show_at('F1', 300.0, 650.0, 'R9: result 27 MARK-COLS')
ops.append('ET')
stream = ('\n'.join(ops) + '\n').encode('latin1')

objs = [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'endstream',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
]
out = bytearray(b'%PDF-1.4\n')
offsets = [0]
for i, body in enumerate(objs, start=1):
    offsets.append(len(out))
    out += f'{i} 0 obj\n'.encode() + body + b'\nendobj\n'
xref = len(out)
out += f'xref\n0 {len(objs)+1}\n'.encode()
out += b'0000000000 65535 f \n'
for off in offsets[1:]:
    out += f'{off:010d} 00000 n \n'.encode()
out += f'trailer << /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
path = Path(__file__).parent / 'pdf-spacing.pdf'
path.write_bytes(out)
print(path, path.stat().st_size)
