"""Format/source-reference checks only; never SEC semantic analysis or repair."""
from pathlib import Path
import json,hashlib,argparse
from jsonschema import Draft202012Validator,FormatChecker
R=Path(__file__).parent
def sha(b):return hashlib.sha256(b).hexdigest()
def validate(value,source):
    errors=[]
    schema=json.loads((R/'os-snapshot-v1.schema.json').read_text(encoding='utf8'))
    for e in Draft202012Validator(schema,format_checker=FormatChecker()).iter_errors(value):
        errors.append({'stage':'schema','path':'/'+ '/'.join(map(str,e.absolute_path)),'message':e.message})
    if errors:return {'parse':True,'schema':False,'structure':False,'errors':errors,'meaning':'NOT_ASSESSED'}
    source=Path(source)
    docs={d['id']:d for d in json.loads((source/'documents.json').read_text(encoding='utf8'))['documents']}
    rawblocks=[json.loads(s) for s in (source/'blocks.jsonl').read_text(encoding='utf8').splitlines()]
    blocks={b['id']:b for b in rawblocks}
    if len(blocks)!=len(rawblocks):errors.append({'stage':'reference','message':'Duplicate source block IDs'})
    ids=set(b for row in value['current_os']+(value['review']['candidates'] if value['review'] else []) for b in row['evidence_blocks'])
    checked=set();texts={}
    for bid in sorted(ids):
        if bid not in blocks:
            errors.append({'stage':'reference','block':bid,'message':'Unknown source block'});continue
        b=blocks[bid]; did=b['document_id']
        if did not in docs:
            errors.append({'stage':'reference','block':bid,'message':'Unknown document'});continue
        d=docs[did]
        if did not in checked:
            for pk,hk in [('text_path','text_sha256'),('original_path','original_sha256')]:
                f=source/d[pk]
                if not f.exists() or sha(f.read_bytes())!=d[hk]:errors.append({'stage':'source_hash','document':did,'path':d[pk]})
            texts[did]=(source/d['text_path']).read_text(encoding='utf8').splitlines();checked.add(did)
        excerpt='\n'.join(texts[did][b['line_start']-1:b['line_end']])
        if excerpt!=b['text'] or sha(b['text'].encode('utf8'))!=b['sha256']:
            errors.append({'stage':'source_block','block':bid,'message':'Block content/hash does not match source position'})
    return {'parse':True,'schema':True,'structure':not errors,'errors':errors,'meaning':'NOT_ASSESSED'}
def run(output,source):
    try:v=json.loads(Path(output).read_text(encoding='utf8'))
    except Exception as e:return {'parse':False,'schema':False,'structure':False,'errors':[{'stage':'parse','message':str(e)}],'meaning':'NOT_ASSESSED'}
    try:return validate(v,source)
    except Exception as e:return {'parse':True,'schema':None,'structure':False,'errors':[{'stage':'source_access','message':str(e)}],'meaning':'NOT_ASSESSED'}
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('output');a.add_argument('source');a.add_argument('--report',required=True);x=a.parse_args();r=run(x.output,x.source);Path(x.report).write_text(json.dumps(r,indent=2)+'\n',encoding='utf8');print(json.dumps(r))
