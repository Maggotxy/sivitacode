/** Python control program executed inside the pinned SSH world. */

export const FS_SSH_HELPER = String.raw`
import base64, fcntl, hashlib, json, os, pathlib, stat, sys, tempfile

def version(st):
    facts = [st.st_dev, st.st_ino, st.st_mode, st.st_size, st.st_mtime_ns, st.st_ctime_ns]
    return 'ssh:' + hashlib.sha256(json.dumps(facts, separators=(',', ':')).encode()).hexdigest()

def kind(mode, link=False):
    if link and stat.S_ISLNK(mode): return 'symlink'
    if stat.S_ISREG(mode): return 'file'
    if stat.S_ISDIR(mode): return 'directory'
    return 'other'

def info(st, link=False):
    value = {'version': version(st), 'type': kind(st.st_mode, link)}
    if stat.S_ISREG(st.st_mode): value['size'] = st.st_size
    return value

def error(code, message):
    print(json.dumps({'ok': False, 'code': code, 'message': message}, separators=(',', ':')))
    sys.exit(0)

def require_file(path):
    try: st = os.stat(path)
    except FileNotFoundError: error('FS_NOT_FOUND', 'not found')
    if not stat.S_ISREG(st.st_mode): error('FS_NOT_REGULAR_FILE', 'not a regular file')
    return st

def read_bytes(path, maximum=None):
    st = require_file(path)
    if maximum is not None and st.st_size > maximum: error('FS_TOO_LARGE', 'file exceeds byte limit')
    with open(path, 'rb') as stream:
        data = stream.read() if maximum is None else stream.read(maximum + 1)
    if maximum is not None and len(data) > maximum: error('FS_TOO_LARGE', 'file exceeds byte limit')
    return data

def text(data):
    if b'\0' in data[:8192]: error('FS_NOT_TEXT', 'binary file')
    try: return data.decode('utf-8')
    except UnicodeDecodeError: error('FS_NOT_TEXT', 'invalid UTF-8 text')

def optional_text(data):
    if data is None or b'\0' in data[:8192]: return None
    try: return data.decode('utf-8').replace('\r\n', '\n')
    except UnicodeDecodeError: return None

def lock_for(path):
    root = os.path.join(tempfile.gettempdir(), '.sivitacode-fs-locks-' + str(os.getuid()))
    os.makedirs(root, mode=0o700, exist_ok=True)
    os.chmod(root, 0o700)
    name = hashlib.sha256(path.encode('utf-8')).hexdigest()
    handle = open(os.path.join(root, name), 'a+b')
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    return handle

def atomic_write(path, data):
    parent = os.path.dirname(path)
    if not os.path.isdir(parent): error('FS_NOT_FOUND', 'parent directory not found')
    fd, temporary = tempfile.mkstemp(prefix='.sivitacode-', dir=parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        try: os.chmod(temporary, stat.S_IMODE(os.stat(path).st_mode))
        except FileNotFoundError: os.chmod(temporary, 0o644)
        os.replace(temporary, path)
        directory = os.open(parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        try: os.unlink(temporary)
        except FileNotFoundError: pass

request = json.load(sys.stdin)
op = request['op']
path = request.get('path')
try:
    if op == 'resolve':
        candidate = request['value']
        if not os.path.isabs(candidate): candidate = os.path.join(request['cwd'], candidate)
        print(json.dumps({'ok': True, 'path': os.path.realpath(candidate)}, separators=(',', ':')))
    elif op == 'stat':
        try: st = os.stat(path)
        except FileNotFoundError: print(json.dumps({'ok': True, 'info': None}, separators=(',', ':'))); sys.exit(0)
        print(json.dumps({'ok': True, 'info': info(st)}, separators=(',', ':')))
    elif op == 'lstat':
        try: st = os.lstat(path)
        except FileNotFoundError: print(json.dumps({'ok': True, 'info': None}, separators=(',', ':'))); sys.exit(0)
        print(json.dumps({'ok': True, 'info': info(st, True)}, separators=(',', ':')))
    elif op == 'read':
        data = read_bytes(path, request.get('maxBytes'))
        if request.get('text'): text(data)
        print(json.dumps({'ok': True, 'data': base64.b64encode(data).decode('ascii')}, separators=(',', ':')))
    elif op == 'list':
        st = os.stat(path)
        if not stat.S_ISDIR(st.st_mode): error('FS_NOT_DIRECTORY', 'not a directory')
        entries = []
        with os.scandir(path) as scan:
            for entry in scan:
                child_path = os.path.realpath(entry.path)
                child_st = os.stat(entry.path)
                row = {'name': entry.name, 'path': child_path, **info(child_st)}
                entries.append(row)
        entries.sort(key=lambda value: value['name'])
        print(json.dumps({'ok': True, 'entries': entries}, separators=(',', ':')))
    elif op in ('write', 'edit'):
        lock = lock_for(path)
        try:
            exists = os.path.exists(path)
            before_bytes = read_bytes(path) if exists else None
            before_version = version(os.stat(path)) if exists else None
            expected = request.get('expected')
            if expected:
                if expected['kind'] == 'createIfAbsent' and exists: error('FS_NOT_OBSERVED', 'target exists')
                if expected['kind'] == 'replaceIfVersion' and (not exists or before_version != expected['version']): error('FS_STALE_VERSION', 'target version changed')
            if op == 'edit':
                if not exists: error('FS_NOT_FOUND', 'not found')
                content = text(before_bytes).replace('\r\n', '\n')
                old = request['old'].replace('\r\n', '\n')
                new = request['new'].replace('\r\n', '\n')
                if not old: error('FS_EDIT_NOT_FOUND', 'old_string must be non-empty')
                matches = content.count(old)
                if matches == 0: error('FS_EDIT_NOT_FOUND', 'old_string was not found')
                if not request['all'] and matches != 1: error('FS_AMBIGUOUS_EDIT', 'old_string matched more than once')
                after_text = content.replace(old, new) if request['all'] else content.replace(old, new, 1)
                crlf = before_bytes[:4096].count(b'\r\n') > before_bytes[:4096].count(b'\n') - before_bytes[:4096].count(b'\r\n')
                stored = after_text.replace('\n', '\r\n').encode() if crlf else after_text.encode()
            else:
                after_text = request['content'].replace('\r\n', '\n')
                stored = request['content'].encode()
            atomic_write(path, stored)
            result = {'ok': True, 'version': version(os.stat(path)), 'after': after_text}
            if op == 'write':
                result['operation'] = 'update' if exists else 'create'
                result['before'] = optional_text(before_bytes)
            else:
                result['before'] = text(before_bytes).replace('\r\n', '\n')
            print(json.dumps(result, separators=(',', ':')))
        finally: lock.close()
except PermissionError: error('FS_PERMISSION_DENIED', 'permission denied')
except FileNotFoundError: error('FS_NOT_FOUND', 'not found')
except NotADirectoryError: error('FS_NOT_DIRECTORY', 'not a directory')
except OSError as failure: error('FS_IO_ERROR', str(failure))
`
