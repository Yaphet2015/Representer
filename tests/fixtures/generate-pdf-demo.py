from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from pathlib import Path
p=Path(__file__).parent/'pdf-demo.pdf'
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
c=canvas.Canvas(str(p),pagesize=(595,842),pageCompression=1)
c.setTitle('Representer PDF DEMO - 3 pages')
def text(x,y,s,font='Helvetica',size=11):
 c.setFont(font,size);c.drawString(x,y,s)
def footer(n):
 text(48,36,f'Page {n} of 3 | REPRESENT-PDF-DEMO-20261118'); c.showPage()
text(48,785,'EXAMPLE TEST CONTENT - PDF DEMO','Helvetica-Bold',17)
text(48,748,'PDF-ALPHA-173: Revenue is 12 million; this is synthetic data.')
text(48,723,'Shared sentence: operating margin improved this quarter.')
text(48,695,'中文唯一标记：青竹计划。第一页收入为一千二百万元。','STSong-Light')
text(48,662,'Page 1 goal: identify the source page and preserve the unique marker.')
footer(1)
text(48,785,'Page 2 - Similar paragraph, different numbers','Helvetica-Bold',16)
text(48,746,'PDF-BETA-284: Revenue is 21 million; do not confuse with page 1.')
text(48,720,'Shared sentence: operating margin improved this quarter.')
text(48,690,'中文唯一标记：白鹭计划。第二页收入为二千一百万元。','STSong-Light')
text(48,650,'Left column - method','Helvetica-Bold',12)
text(315,650,'Right column - result','Helvetica-Bold',12)
for i in range(9):
 text(48,620-23*i,f'L{i+1}: Sample {i+1} uses method A.',size=10)
 text(315,620-23*i,f'R{i+1}: Result equals {(i+1)*3} units.',size=10)
footer(2)
text(48,785,'Page 3 - Conclusion','Helvetica-Bold',17)
text(48,745,'PDF-GAMMA-395: Costs fell 8 percent; this is synthetic data.')
text(48,715,'Shared sentence: operating margin improved this quarter.')
text(48,680,'中文唯一标记：丹桂计划。第三页成本下降百分之八。','STSong-Light')
text(48,640,'End marker: END-OF-PDF-649. No model call is required to test extraction.')
footer(3);c.save()
assert p.stat().st_size < 100_000
print(str(p), p.stat().st_size)
