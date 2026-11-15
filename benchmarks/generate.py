"""Generate exact decimal GB ZIP64 archives on a sparse-file-capable filesystem."""
import hashlib
import io
import json
import os
from pathlib import Path
import random
import sys
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo

destination = Path(sys.argv[1])
block = bytes(8 * 1024**2)
rng = random.Random(1357)
payload = rng.randbytes(32 * 1024**2)
padding = rng.randbytes(1024**2)

class SparseFile:
    """Skip disk allocation only for known zero blocks. zipfile still computes the real CRC."""
    def __init__(self, file):
        self.file = file

    def __getattr__(self, name):
        return getattr(self.file, name)

    def write(self, data):
        if data is block:
            self.file.seek(len(data), os.SEEK_CUR)
            return len(data)
        return self.file.write(data)

def entry(name, method):
    result = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
    result.compress_type = method
    return result

def nested(name, contents, method):
    buffer = io.BytesIO()
    with ZipFile(buffer, 'w') as archive:
        archive.writestr(entry(name, method), contents)
    return buffer.getvalue()

def write_archive(path, filler, branches, prefix):
    with path.open('w+b') as raw, ZipFile(SparseFile(raw), 'w') as archive:
        with archive.open(entry('logs/telemetry.log', ZIP_STORED), 'w', force_zip64=True) as writer:
            writer.write(prefix)
            blocks, remainder = divmod(filler-len(prefix),len(block))
            for _ in range(blocks):
                writer.write(block)
            if remainder:
                writer.write(block[:remainder])
        for name,method,body in branches:
            archive.writestr(entry(name,method),body)
    return path.stat().st_size

for gb in map(int,sys.argv[2:] or ['25','50','100']):
    dest=destination/str(gb)
    dest.mkdir(exist_ok=True,parents=True)
    receipt=f'peekzip {gb} GB: nested file verified\n'.encode()
    prefix=(f'peekzip {gb} GB telemetry start\n'.encode() + b'2026-11-15 INFO station nominal\n' * 100000)[:1024*1024]
    leaves=io.BytesIO()
    with ZipFile(leaves,'w') as archive:
        archive.writestr(entry('notes/receipt.txt',ZIP_DEFLATED),receipt)
        archive.writestr(entry('data/payload.bin',ZIP_STORED),payload)
        archive.writestr(entry('unused.bin',ZIP_STORED),padding)

    branches=[]
    for label,method in [('stored',ZIP_STORED),('deflated',ZIP_DEFLATED)]:
        inner=leaves.getvalue()
        if label=='stored':
            oversized=io.BytesIO(inner)
            with ZipFile(oversized,'a') as extra:
                extra.writestr(entry('unused-large.bin',ZIP_STORED),bytes(70*1024**2))
            inner=oversized.getvalue()
        middle=nested('level-2.zip',inner,method)
        branches.append((label+'.zip',method,middle))

    # A provisional ZIP64 member determines exact overhead, including compressed data and all ZIP64 records.
    path=dest/'archive.zip'
    provisional=2**32+1
    overhead=write_archive(path,provisional,branches,prefix)-provisional
    desired=gb*10**9
    filler=desired-overhead
    size=write_archive(path,filler,branches,prefix)
    assert size==desired
    with ZipFile(path) as a:
        entries={i.filename:{'size':i.file_size,'compressed':i.compress_size,'method':i.compress_type,'offset':i.header_offset,'crc32':f'{i.CRC:08x}'} for i in a.infolist()}
        for name,method,body in branches:
            assert a.getinfo(name).header_offset>2**32
            with ZipFile(io.BytesIO(a.read(name))) as b, ZipFile(io.BytesIO(b.read('level-2.zip'))) as c:
                assert c.read('notes/receipt.txt')==receipt
                assert c.read('data/payload.bin')==payload
        # Verify the text prefix independently. The browser later verifies the nested data beyond this member.
        with a.open('logs/telemetry.log') as hole:
            assert hole.read(len(prefix))==prefix
    meta=dict(archiveBytes=size, sizeGB=gb, allocatedBytes=path.stat().st_blocks*512, telemetryHeader=prefix.split(b'\n')[0].decode(), telemetryPrefixSha256=hashlib.sha256(prefix[:192*1024]).hexdigest(), receipt=receipt.decode(), receiptSha256=hashlib.sha256(receipt).hexdigest(),payloadBytes=len(payload),payloadSha256=hashlib.sha256(payload).hexdigest(),entries=entries)
    (dest/'metadata.json').write_text(json.dumps(meta,indent=2))
    print(f'generated {size:,} bytes; {name} header at {entries[name]["offset"]:,}',flush=True)
