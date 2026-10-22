import argparse
from pathlib import Path
from repair.files import read_json
from repair.pdf import generate
from repair.server import serve


def main():
    parser = argparse.ArgumentParser(description='Zotero PaddleOCR PDF Repair helper')
    sub = parser.add_subparsers(dest='command',required=True)
    server = sub.add_parser('serve')
    server.add_argument('--data',required=True)
    server.add_argument('--connection',required=True)
    convert = sub.add_parser('convert',help='Local PDF+MD+JSON only; no remote calls')
    for field in ('pdf','json','md','out'):
        convert.add_argument('--'+field,required=True)
    convert.add_argument('--legacy-pdf-scale',type=float,default=0,help='Known old PaddleOCR PDF raster scale; 0 requires explicit JSON sizes')
    args = parser.parse_args()
    if args.command=='serve':
        serve(args.data,args.connection)
    else:
        if Path(args.pdf).resolve()==Path(args.out).resolve() or Path(args.out).exists():
            parser.error('输出必须是新的文件路径；不能覆盖输入或已有文件')
        print(generate(args.pdf,read_json(args.json),Path(args.md).read_text(encoding='utf-8-sig'),args.out,legacy_scale=args.legacy_pdf_scale))


if __name__=='__main__':
    main()
