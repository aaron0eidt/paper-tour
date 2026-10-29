#!/usr/bin/env python3
"""Create original CC0 synthetic PDFs and cached, authored test tours, without any provider calls.

  ingest/.venv/bin/python scripts/create-demo-fixtures.py
Generated files live only in ignored demo/local-* folders; never pass private documents here.
"""
import json
from pathlib import Path
import sys
import pymupdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ingest'))
from process import process_pdf

DOCS = {
    'research': ('Contextual models', [
        ('1 Introduction', 'A contextual model gives each word a representation that depends on the surrounding words. This helps distinguish meanings that a fixed dictionary vector would mix together.'),
        ('2 Method', 'First the encoder reads the input. Then a weighted sum combines the useful features. A sigmoid maps this sum into a probability between zero and one.'),
        ('3 Results', 'The baseline reaches 70 percent accuracy. The contextual model reaches 82 percent accuracy. These synthetic numbers illustrate a comparison and are not a research claim.'),
        ('4 Limitations', 'The evaluation uses a small synthetic dataset. The result does not establish performance on real documents.')]),
    'maths-de': ('Übungsblatt Funktionen', [
        ('Aufgabe 1', 'Berechnen Sie die Ableitung der Funktion f(x) = x^2. Erklären Sie, warum die Steigung für positive Werte von x wächst.'),
        ('Aufgabe 2', 'Bestimmen Sie für die Funktion g(x) = 2*x + 3 den Wert an der Stelle x = 4. Prüfen Sie das Ergebnis durch Einsetzen.')]),
    'lecture': ('Lecture: functions and evidence', [
        ('1 Inputs and outputs', 'A function maps each allowed input to exactly one output. Changing a parameter changes the entire relationship rather than only one point.'),
        ('2 Reading a graph', 'The horizontal axis shows the input and the vertical axis shows the output. A steep curve means that small input changes can produce large output changes.'),
        ('3 Checking an explanation', 'A useful explanation connects a claim to evidence. An illustrative graph explains a mechanism but does not replace experimental measurements.')]),
    'lease-v1': ('Synthetic tenancy agreement', [
        ('1 Parties and term', 'This synthetic agreement is between Example Tenant and Example Landlord. The tenancy starts on 1 January 2027 and ends on 31 December 2027.'),
        ('2 Rent and deposit', 'The monthly rent is 800 EUR, payable by the fifth day of each month. The deposit is 1600 EUR.'),
        ('3 Notice', 'Either party must give three months of written notice. No automatic renewal is stated in this document.')]),
    'lease-v2': ('Synthetic tenancy agreement revised', [
        ('1 Parties and term', 'This synthetic agreement is between Example Tenant and Example Landlord. The tenancy starts on 1 January 2027 and ends on 31 December 2027.'),
        ('2 Rent and deposit', 'The monthly rent is 850 EUR, payable by the third day of each month. The deposit is 1700 EUR.'),
        ('3 Notice', 'Either party must give two months of written notice. No automatic renewal is stated in this document.')]),
    'terms': ('Synthetic service terms', [
        ('1 Service', 'The service stores documents for the account holder. Documents are private by default and are removed when the account holder requests deletion.'),
        ('2 Costs', 'The synthetic demonstration has no charge. This sentence is fixture content and does not describe the price of the actual application.'),
        ('3 Changes', 'A material change to the terms requires thirty days of notice. The user can export their documents before closing the account.')]),
    'letter-de': ('Musterbrief zur Frist', [
        ('Ihr Vorgang', 'Sehr geehrte Beispielperson, für Ihren Antrag fehlt noch ein Nachweis. Bitte reichen Sie die Kopie bis zum 15. November 2026 ein.'),
        ('Was Sie tun müssen', 'Schreiben Sie die Vorgangsnummer TEST-2026 auf das Formular. Senden Sie nur die angeforderte Kopie und bewahren Sie das Original auf.'),
        ('Bei Rückfragen', 'Die Frist und die erforderlichen Angaben stehen in diesem Musterbrief. Der Brief ist vollständig erfunden und enthält keine persönlichen Daten.')]),
}


def write_pdf(path, title, sections, slides=False):
    pdf = pymupdf.open()
    if slides:
        for heading, text in sections:
            page = pdf.new_page(width=800, height=450)
            page.insert_text((45, 65), title, fontsize=22)
            page.insert_text((45, 125), heading, fontsize=19)
            page.insert_textbox((45, 165, 750, 360), text, fontsize=17)
    else:
        for start in range(0,len(sections),2):
            page=pdf.new_page(width=600,height=800)
            page.insert_text((45,55),title,fontsize=20)
            for i,(heading,text) in enumerate(sections[start:start+2]):
                y=100+i*250
                page.insert_text((45,y),heading,fontsize=15)
                page.insert_textbox((45,y+25,555,y+165),text,fontsize=12,lineheight=1.5)
            page.insert_text((45,760),'Original synthetic fixture - CC0 - no personal data',fontsize=9)
    pdf.set_metadata({'title':title,'author':'Paper Tour synthetic test fixture','subject':'CC0 original synthetic content'})
    pdf.save(path);pdf.close()


def cached_tour(doc, paper):
    sentences=doc['sentences']
    steps=[]
    german=paper.endswith('maths-de') or paper.endswith('letter-de')
    for i,sentence in enumerate(sentences[:4]):
        say=('Hier betrachten wir eine Aussage und ihren Zusammenhang. Prüfen Sie die markierte Stelle und fragen Sie nach, wenn ein Schritt unklar bleibt.' if german else 'This is a synthetic offline demonstration. The highlighted passage is the evidence; use the question field to explore its meaning and check the source before relying on a conclusion.')
        actions=[{'type':'focus','target':sentence['id']},{'type':'highlight','targets':[sentence['id']]}]
        if i==1:
            actions.extend([{'type':'board','item':{'kind':'plot','title':'Illustrative parameter sweep','x':[-4,4],'y':[0,1],'curves':[{'expression':'sigmoid(a*x)','label':'\\sigma(ax)','color':'blue'}],'parameter':{'from':0.5,'to':2}}},{'type':'board_focus','part':0}])
        elif i==2:
            actions.extend([{'type':'board_clear'},{'type':'circle','target':sentence['block'],'label':'Check the evidence','color':'green'}])
        steps.append({'id':f'step-{i+1}','say':say,'hold_ms':150,'actions':actions})
    return {'schema':'paper-tour/tour@0.1','title':doc['source'].get('title',paper)+' - offline fixture','paper':paper,'doc_sha256':doc['source']['sha256'],'voices':{'host':{'lang':'de-DE' if german else 'en-US','rate':1}},'suggested_questions':['What does this mean?','Why does the function change?','What should I check?'],'chapters':[{'id':'demo','title':'Synthetic offline demo','steps':steps}]}


def main():
    manifest=[]
    for name,(title,sections) in DOCS.items():
        paper='local-'+name;folder=ROOT/'demo'/paper;folder.mkdir(parents=True,exist_ok=True)
        source=folder/'paper.pdf';write_pdf(source,title,sections,name=='lecture')
        process_pdf(source,folder)
        doc=json.loads((folder/'doc.json').read_text())
        (folder/'tour.json').write_text(json.dumps(cached_tour(doc,paper),ensure_ascii=False,indent=2)+'\n')
        manifest.append({'paper':paper,'title':title,'license':'CC0; original synthetic fixture','pages':len(doc['pages']),'sentences':len(doc['sentences']),'tour':'authored offline test fixture, not a model quality sample'})
    out=ROOT/'.data'/'air-test';out.mkdir(parents=True,exist_ok=True)
    (out/'fixture-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(f'Created {len(manifest)} original synthetic fixtures and cached tours. No API calls.')
if __name__=='__main__': main()
